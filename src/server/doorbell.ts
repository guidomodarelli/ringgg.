import { DOORBELL, HTTP, PAUSE, VISIT_REPLIES, type PauseMode, type VisitReply } from '@/constants/doorbell';
import type { Home, HomeState, Visit, Device, PublicVisit, PublicHome, DeliveryStatus, DashboardSnapshot, RingRequest } from '@/types/doorbell';
import type { HomeMember } from '@/types/residents';
import { isQuietTime } from '@/lib/quiet-hours';
import { isPaused, pauseEnd, pauseEndLabel } from '@/lib/pause';
import type { Database } from './database';
import { AppError } from './errors';
import { enforceRingLimits } from './rate-limit';
import { homeNameSchema, requireFreeHomeName } from './homes';
import { listResidentHomes, residentSettings } from './residents';

const HOME_COLUMNS = 'id, name, token, enabled, paused_until, quiet_start, quiet_end';
const PUBLIC_VISIT_COLUMNS = 'id, created_at, answered_at, delivery, reply, note IS NOT NULL AS noted';
const RECEIPTS_COLUMN = '(SELECT COUNT(*)::int FROM visit_receipts r WHERE r.visit_id = visits.id) AS receipts';
const VISIT_COLUMNS = `id, message, created_at, answered_at, delivery, reply, answered_by, note, noted_at, ${RECEIPTS_COLUMN}`;
/** A device as this home sees it: its name here, and its owner as this home calls them. */
const HOME_DEVICES = `SELECT d.id, dh.name, dh.created_at, COALESCE(m.display_name, d.owner_name, split_part(d.resident_email, '@', 1)) AS owner,
  d.last_success_at, d.last_failure_at, d.last_failure_status, d.last_received_at
  FROM device_homes dh JOIN devices d ON d.id = dh.device_id LEFT JOIN home_members m ON m.home_id = dh.home_id AND m.email = d.resident_email
  WHERE dh.home_id = $1 ORDER BY dh.created_at, d.id`;

const INVALID_DOORBELL_MESSAGE = 'Este timbre ya no está disponible. Pedí el QR actualizado.';

export async function getHome(database: Database, homeId: number): Promise<Home> {
  const [home] = (await database.query<Home>(`SELECT ${HOME_COLUMNS} FROM homes WHERE id = $1`, [homeId])).rows;
  if (!home) throw new AppError(HTTP.notFound, 'HOME_NOT_FOUND', 'Esa casa ya no existe.');
  return home;
}

/** The QR token is the visitor's only key: it identifies the home and nothing else. */
async function homeByToken(database: Database, token: string, lock = false): Promise<Home> {
  const [home] = (await database.query<Home>(`SELECT ${HOME_COLUMNS} FROM homes WHERE token = $1${lock ? ' FOR UPDATE' : ''}`, [token])).rows;
  if (!home) throw new AppError(HTTP.notFound, 'INVALID_DOORBELL', INVALID_DOORBELL_MESSAGE);
  return home;
}

export function homeState(home: Home, now = new Date()): HomeState {
  return { ...home, paused: isPaused(home, now), quiet: isQuietTime(home, now) };
}

/**
 * The drivers return timestamps as `Date` objects. Encoding the snapshot as JSON turns them into the ISO
 * strings its type declares, the same values the dashboard API sends.
 */
function toJsonSnapshot(snapshotRows: DashboardSnapshot): DashboardSnapshot {
  const json = JSON.stringify(snapshotRows);
  return JSON.parse(json) as DashboardSnapshot;
}

/** Only visits inside the retention window are shown, even when nobody rang to trigger a purge. */
export async function snapshot(database: Database, homeId: number): Promise<DashboardSnapshot> {
  const [home, visits, devices] = await Promise.all([
    getHome(database, homeId),
    database.query<Visit>(`SELECT ${VISIT_COLUMNS} FROM visits WHERE home_id = $3 AND created_at > NOW() - $2 * INTERVAL '1 day' ORDER BY created_at DESC LIMIT $1`, [DOORBELL.historyLimit, DOORBELL.retentionDays, homeId]),
    database.query<Device>(HOME_DEVICES, [homeId]),
  ]);
  return toJsonSnapshot({ home: homeState(home), visits: visits.rows, devices: devices.rows });
}

export async function publicHome(database: Database, token: string): Promise<PublicHome> {
  const home = await homeByToken(database, token);
  const quiet = isQuietTime(home);
  return { name: home.name, paused: isPaused(home), pausedUntil: pauseEnd(home), quiet, quietUntil: quiet ? home.quiet_end : null };
}

function pausedMessage(home: Home) {
  const end = pauseEnd(home);
  return end ? `El timbre está en pausa ${pauseEndLabel(end)}. Intentá más tarde.` : 'El timbre está en pausa. Intentá más tarde.';
}

/** The home row lock makes rate limits and idempotency atomic across every server instance. */
export async function registerVisit(database: Database, token: string, ring: RingRequest): Promise<{ visit: PublicVisit; created: boolean; home: Pick<Home, 'id' | 'name'> }> {
  return database.transaction(async (transaction) => {
    const home = await homeByToken(transaction, token, true);
    const [existing] = (await transaction.query<PublicVisit & { home_id: number }>(`SELECT home_id, ${PUBLIC_VISIT_COLUMNS} FROM visits WHERE id = $1`, [ring.id])).rows;
    if (existing) {
      // A retry of this ring returns it; an id taken by another home's visit is never disclosed.
      if (existing.home_id !== home.id) throw new AppError(HTTP.conflict, 'RING_ID_TAKEN', 'No pudimos registrar el timbrazo. Volvé a tocar el timbre.');
      const { home_id: _homeId, ...visit } = existing;
      return { visit, created: false, home: { id: home.id, name: home.name } };
    }
    if (isPaused(home)) throw new AppError(HTTP.conflict, 'PAUSED', pausedMessage(home));
    if (isQuietTime(home)) throw new AppError(HTTP.conflict, 'QUIET_HOURS', `Ahora es horario de descanso en esta casa. Probá después de las ${home.quiet_end}.`);
    await enforceRingLimits(transaction, home.id, ring.client);
    await transaction.query(`DELETE FROM visits WHERE home_id = $2 AND created_at < NOW() - $1 * INTERVAL '1 day'`, [DOORBELL.retentionDays, home.id]);
    const result = await transaction.query<PublicVisit>(`INSERT INTO visits (id, home_id, message) VALUES ($1, $2, $3) RETURNING ${PUBLIC_VISIT_COLUMNS}`, [ring.id, home.id, ring.message]);
    return { visit: result.rows[0], created: true, home: { id: home.id, name: home.name } };
  });
}

/** One round trip: the token check and the visit of that home come from the same query. */
export async function readVisit(database: Database, token: string, id: string): Promise<PublicVisit> {
  const result = await database.query<PublicVisit & { found: boolean }>(
    `SELECT v.id IS NOT NULL AS found, v.id, v.created_at, v.answered_at, v.delivery, v.reply, v.note IS NOT NULL AS noted
     FROM homes h LEFT JOIN visits v ON v.id = $2 AND v.home_id = h.id WHERE h.token = $1`,
    [token, id],
  );
  const [row] = result.rows;
  if (!row) throw new AppError(HTTP.notFound, 'INVALID_DOORBELL', INVALID_DOORBELL_MESSAGE);
  if (!row.found) throw new AppError(HTTP.notFound, 'VISIT_NOT_FOUND', 'No encontramos este timbrazo.');
  const { found: _found, ...visit } = row;
  return visit;
}

/** The home a visit belongs to, so an answer from a notification can be authorized for that home. */
export async function visitHomeId(database: Database, id: string): Promise<number> {
  const [visit] = (await database.query<{ home_id: number }>('SELECT home_id FROM visits WHERE id = $1', [id])).rows;
  if (!visit) throw new AppError(HTTP.notFound, 'VISIT_NOT_FOUND', 'Ese timbrazo ya no está en el historial.');
  return visit.home_id;
}

/** A visit of one home: an answer only reaches a visit of the home it comes from. */
export interface VisitKey { homeId: number; id: string }

/** Repeated acknowledgments preserve the first answer, reply and resident, and reject expired visits. */
export async function answerVisit(database: Database, visit: VisitKey, reply: VisitReply = 'coming', answeredBy: string | null = null): Promise<Visit> {
  if (!Object.hasOwn(VISIT_REPLIES, reply)) throw new AppError(HTTP.badRequest, 'INVALID_REPLY', 'Elegí una respuesta válida.');
  const result = await database.query<Visit>(
    `UPDATE visits SET answered_at = COALESCE(answered_at, NOW()), reply = CASE WHEN answered_at IS NULL THEN $3 ELSE reply END, answered_by = CASE WHEN answered_at IS NULL THEN $4 ELSE answered_by END
     WHERE id = $1 AND home_id = $5 AND (answered_at IS NOT NULL OR created_at > NOW() - $2 * INTERVAL '1 second') RETURNING ${VISIT_COLUMNS}`,
    [visit.id, DOORBELL.responseWindowSeconds, reply, answeredBy?.slice(0, DOORBELL.answeredByMaxLength) || null, visit.homeId],
  );
  if (!result.rows[0]) throw new AppError(HTTP.conflict, 'VISIT_EXPIRED', 'Este timbrazo ya venció. Podés consultarlo en el historial.');
  return result.rows[0];
}

/**
 * A visitor can leave one note when nobody answered in time or the residents said they are away.
 * Retrying after a lost response returns the stored state instead of sending a second notification.
 */
export async function leaveNote(database: Database, token: string, id: string, note: string): Promise<{ visit: PublicVisit; created: boolean; home: Pick<Home, 'id' | 'name'> }> {
  const home = await homeByToken(database, token);
  const updated = await database.query<PublicVisit>(
    `UPDATE visits SET note = $2, noted_at = NOW()
     WHERE id = $1 AND home_id = $5 AND note IS NULL AND created_at > NOW() - $3 * INTERVAL '1 second'
       AND ((answered_at IS NULL AND created_at <= NOW() - $4 * INTERVAL '1 second') OR reply = 'away')
     RETURNING ${PUBLIC_VISIT_COLUMNS}`,
    [id, note, DOORBELL.noteWindowSeconds, DOORBELL.responseWindowSeconds, home.id],
  );
  if (updated.rows[0]) return { visit: updated.rows[0], created: true, home: { id: home.id, name: home.name } };
  const current = await readVisit(database, token, id);
  if (current.noted) return { visit: current, created: false, home: { id: home.id, name: home.name } };
  throw new AppError(HTTP.conflict, 'NOTE_UNAVAILABLE', 'Ya no se puede dejar un mensaje para este timbrazo.');
}

/** Returns the visitor-facing visit so the ring response needs no extra read. */
export async function setDelivery(database: Database, id: string, delivery: DeliveryStatus): Promise<PublicVisit> {
  return (await database.query<PublicVisit>(`UPDATE visits SET delivery = $2 WHERE id = $1 RETURNING ${PUBLIC_VISIT_COLUMNS}`, [id, delivery])).rows[0];
}

/**
 * Only the name: the pause has its own operation, so a stale form never resumes a paused bell. The
 * name must differ from the resident's other homes, so their home switcher never shows two alike.
 */
export async function updateHomeName(database: Database, member: HomeMember, input: string, settings = residentSettings()) {
  const name = homeNameSchema.parse(input);
  requireFreeHomeName(await listResidentHomes(database, member, settings), name, member.homeId);
  await database.query('UPDATE homes SET name = $1 WHERE id = $2', [name, member.homeId]);
}

/** Both ends are set together; `null` for both turns quiet hours off. */
export async function updateQuietHours(database: Database, homeId: number, start: string | null, end: string | null) {
  if ((start === null) !== (end === null) || (start !== null && start === end)) throw new AppError(HTTP.badRequest, 'INVALID_QUIET_HOURS', 'Elegí un horario de inicio y de fin distintos.');
  await database.query('UPDATE homes SET quiet_start = $1, quiet_end = $2 WHERE id = $3', [start, end, homeId]);
}

/**
 * Timed pauses end on their own: nothing has to run when they expire. "Morning" is the next
 * occurrence of the resume time in the home's time zone, so pausing at 1:00 resumes the same day.
 * The home id is always the last parameter.
 */
const PAUSE_UPDATES: Record<PauseMode, [string, unknown[]]> = {
  resume: ['UPDATE homes SET enabled = TRUE, paused_until = NULL WHERE id = $1', []],
  indefinite: ['UPDATE homes SET enabled = FALSE, paused_until = NULL WHERE id = $1', []],
  hour: [`UPDATE homes SET enabled = TRUE, paused_until = NOW() + $1 * INTERVAL '1 minute' WHERE id = $2`, [PAUSE.hourMinutes]],
  morning: [
    `UPDATE homes SET enabled = TRUE, paused_until = (
       date_trunc('day', NOW() AT TIME ZONE $1)
       + CASE WHEN (NOW() AT TIME ZONE $1)::time < $2::time THEN INTERVAL '0 day' ELSE INTERVAL '1 day' END
       + $2::time
     ) AT TIME ZONE $1 WHERE id = $3`,
    [DOORBELL.timeZone, PAUSE.morningResumeTime],
  ],
};

export async function setPause(database: Database, homeId: number, mode: PauseMode) {
  const [sql, params] = PAUSE_UPDATES[mode];
  await database.query(sql, [...params, homeId]);
}

export async function rotateToken(database: Database, homeId: number) {
  await database.query('UPDATE homes SET token = $1 WHERE id = $2', [crypto.randomUUID(), homeId]);
}

/**
 * Daily cleanup that keeps the retention promise when nobody rings: visits (with their messages,
 * notes and receipts) older than the retention window and expired visitor rate limits, in every home.
 */
export async function purgeExpiredData(database: Database): Promise<{ visits: number; rateLimits: number }> {
  const visits = await database.query<{ count: number }>(`WITH gone AS (DELETE FROM visits WHERE created_at < NOW() - $1 * INTERVAL '1 day' RETURNING 1) SELECT COUNT(*)::int AS count FROM gone`, [DOORBELL.retentionDays]);
  const rateLimits = await database.query<{ count: number }>('WITH gone AS (DELETE FROM rate_limits WHERE expires_at <= NOW() RETURNING 1) SELECT COUNT(*)::int AS count FROM gone');
  return { visits: visits.rows[0].count, rateLimits: rateLimits.rows[0].count };
}
