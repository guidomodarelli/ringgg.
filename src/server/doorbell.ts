import { DOORBELL, HTTP, VISIT_REPLIES, type VisitReply } from '@/constants/doorbell';
import type { Home, HomeState, Visit, Device, PublicVisit, PublicHome, DeliveryStatus, DashboardSnapshot } from '@/types/doorbell';
import { isQuietTime } from '@/lib/quiet-hours';
import type { Database } from './database';
import { AppError } from './errors';
import { enforceRingLimits } from './rate-limit';

const PUBLIC_VISIT_COLUMNS = 'id, created_at, answered_at, delivery, reply, note IS NOT NULL AS noted';
const VISIT_COLUMNS = 'id, message, created_at, answered_at, delivery, reply, answered_by, note, noted_at';

export async function getHome(database: Database): Promise<Home> {
  return (await database.query<Home>('SELECT id, name, token, enabled, quiet_start, quiet_end FROM homes WHERE id = 1')).rows[0];
}

export function homeState(home: Home, now = new Date()): HomeState {
  return { ...home, quiet: isQuietTime(home, now) };
}

export async function snapshot(database: Database): Promise<DashboardSnapshot> {
  const [home, visits, devices] = await Promise.all([
    getHome(database),
    database.query<Visit>(`SELECT ${VISIT_COLUMNS} FROM visits ORDER BY created_at DESC LIMIT $1`, [DOORBELL.historyLimit]),
    database.query<Device>('SELECT id, name, created_at FROM devices ORDER BY created_at', []),
  ]);
  return JSON.parse(JSON.stringify({ home: homeState(home), visits: visits.rows, devices: devices.rows })) as DashboardSnapshot;
}

function requireToken(home: Home, token: string) {
  if (home.token !== token) throw new AppError(HTTP.notFound, 'INVALID_DOORBELL', 'Este timbre ya no está disponible. Pedí el QR actualizado.');
}

export async function publicHome(database: Database, token: string): Promise<PublicHome> {
  const home = await getHome(database);
  requireToken(home, token);
  const quiet = isQuietTime(home);
  return { name: home.name, enabled: home.enabled, quiet, quietUntil: quiet ? home.quiet_end : null };
}

/** The home row lock makes rate limits and idempotency atomic across every server instance. */
export async function registerVisit(database: Database, token: string, id: string, message: string, client: string): Promise<{ visit: PublicVisit; created: boolean }> {
  return database.transaction(async (transaction) => {
    const home = (await transaction.query<Home>('SELECT id, name, token, enabled, quiet_start, quiet_end FROM homes WHERE id = 1 FOR UPDATE')).rows[0];
    requireToken(home, token);
    const existing = await transaction.query<PublicVisit>(`SELECT ${PUBLIC_VISIT_COLUMNS} FROM visits WHERE id = $1`, [id]);
    if (existing.rows[0]) return { visit: existing.rows[0], created: false };
    if (!home.enabled) throw new AppError(HTTP.conflict, 'PAUSED', 'El timbre está en pausa. Intentá más tarde.');
    if (isQuietTime(home)) throw new AppError(HTTP.conflict, 'QUIET_HOURS', `Ahora es horario de descanso en esta casa. Probá después de las ${home.quiet_end}.`);
    await enforceRingLimits(transaction, client);
    await transaction.query(`DELETE FROM visits WHERE created_at < NOW() - $1 * INTERVAL '1 day'`, [DOORBELL.retentionDays]);
    const result = await transaction.query<PublicVisit>(`INSERT INTO visits (id, message) VALUES ($1, $2) RETURNING ${PUBLIC_VISIT_COLUMNS}`, [id, message]);
    return { visit: result.rows[0], created: true };
  });
}

/** One round trip: the token check and the visit come from the same query. */
export async function readVisit(database: Database, token: string, id: string): Promise<PublicVisit> {
  const result = await database.query<PublicVisit & { valid: boolean; found: boolean }>(
    `SELECT h.token = $1 AS valid, v.id IS NOT NULL AS found, v.id, v.created_at, v.answered_at, v.delivery, v.reply, v.note IS NOT NULL AS noted
     FROM homes h LEFT JOIN visits v ON v.id = $2 WHERE h.id = 1`,
    [token, id],
  );
  const row = result.rows[0];
  if (!row?.valid) throw new AppError(HTTP.notFound, 'INVALID_DOORBELL', 'Este timbre ya no está disponible. Pedí el QR actualizado.');
  if (!row.found) throw new AppError(HTTP.notFound, 'VISIT_NOT_FOUND', 'No encontramos este timbrazo.');
  const { valid: _valid, found: _found, ...visit } = row;
  return visit;
}

/** Repeated acknowledgments preserve the first answer, reply and resident, and reject expired visits. */
export async function answerVisit(database: Database, id: string, reply: VisitReply = 'coming', answeredBy: string | null = null): Promise<Visit> {
  if (!(reply in VISIT_REPLIES)) throw new AppError(HTTP.badRequest, 'INVALID_REPLY', 'Elegí una respuesta válida.');
  const result = await database.query<Visit>(
    `UPDATE visits SET answered_at = COALESCE(answered_at, NOW()), reply = CASE WHEN answered_at IS NULL THEN $3 ELSE reply END, answered_by = CASE WHEN answered_at IS NULL THEN $4 ELSE answered_by END
     WHERE id = $1 AND (answered_at IS NOT NULL OR created_at > NOW() - $2 * INTERVAL '1 second') RETURNING ${VISIT_COLUMNS}`,
    [id, DOORBELL.responseWindowSeconds, reply, answeredBy?.slice(0, DOORBELL.answeredByMaxLength) || null],
  );
  if (!result.rows[0]) throw new AppError(HTTP.conflict, 'VISIT_EXPIRED', 'Este timbrazo ya venció. Podés consultarlo en el historial.');
  return result.rows[0];
}

/**
 * A visitor can leave one note when nobody answered in time or the residents said they are away.
 * Retrying after a lost response returns the stored state instead of sending a second notification.
 */
export async function leaveNote(database: Database, token: string, id: string, note: string): Promise<{ visit: PublicVisit; created: boolean }> {
  requireToken(await getHome(database), token);
  const updated = await database.query<PublicVisit>(
    `UPDATE visits SET note = $2, noted_at = NOW()
     WHERE id = $1 AND note IS NULL AND created_at > NOW() - $3 * INTERVAL '1 second'
       AND ((answered_at IS NULL AND created_at <= NOW() - $4 * INTERVAL '1 second') OR reply = 'away')
     RETURNING ${PUBLIC_VISIT_COLUMNS}`,
    [id, note, DOORBELL.noteWindowSeconds, DOORBELL.responseWindowSeconds],
  );
  if (updated.rows[0]) return { visit: updated.rows[0], created: true };
  const current = await readVisit(database, token, id);
  if (current.noted) return { visit: current, created: false };
  throw new AppError(HTTP.conflict, 'NOTE_UNAVAILABLE', 'Ya no se puede dejar un mensaje para este timbrazo.');
}

/** Returns the visitor-facing visit so the ring response needs no extra read. */
export async function setDelivery(database: Database, id: string, delivery: DeliveryStatus): Promise<PublicVisit> {
  return (await database.query<PublicVisit>(`UPDATE visits SET delivery = $2 WHERE id = $1 RETURNING ${PUBLIC_VISIT_COLUMNS}`, [id, delivery])).rows[0];
}

export async function updateHomeSettings(database: Database, name: string, enabled: boolean) {
  await database.query('UPDATE homes SET name = $1, enabled = $2 WHERE id = 1', [name, enabled]);
}

/** Both ends are set together; `null` for both turns quiet hours off. */
export async function updateQuietHours(database: Database, start: string | null, end: string | null) {
  if ((start === null) !== (end === null) || (start !== null && start === end)) throw new AppError(HTTP.badRequest, 'INVALID_QUIET_HOURS', 'Elegí un horario de inicio y de fin distintos.');
  await database.query('UPDATE homes SET quiet_start = $1, quiet_end = $2 WHERE id = 1', [start, end]);
}

export async function rotateToken(database: Database) {
  await database.query('UPDATE homes SET token = $1 WHERE id = 1', [crypto.randomUUID()]);
}
