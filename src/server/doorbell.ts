import { DOORBELL, HTTP } from '@/constants/doorbell';
import type { Home, Visit, Device, PublicVisit, DeliveryStatus } from '@/types/doorbell';
import type { Database } from './database';
import { AppError } from './errors';

export async function getHome(database: Database): Promise<Home> {
  return (await database.query<Home>('SELECT * FROM homes WHERE id = 1')).rows[0];
}

export async function snapshot(database: Database) {
  const [home, visits, devices] = await Promise.all([
    getHome(database),
    database.query<Visit>('SELECT * FROM visits ORDER BY created_at DESC LIMIT $1', [DOORBELL.historyLimit]),
    database.query<Device>('SELECT id, name, created_at FROM devices ORDER BY created_at', []),
  ]);
  return JSON.parse(JSON.stringify({ home, visits: visits.rows, devices: devices.rows })) as { home: Home; visits: Visit[]; devices: Device[] };
}

export async function publicHome(database: Database, token: string) {
  const home = await getHome(database);
  if (home.token !== token) throw new AppError(HTTP.notFound, 'INVALID_DOORBELL', 'Este timbre ya no está disponible. Pedí el QR actualizado.');
  return { name: home.name, enabled: home.enabled };
}

/** The home row lock makes cooldown and idempotency atomic across every server instance. */
export async function registerVisit(database: Database, token: string, id: string, message: string): Promise<{ visit: PublicVisit; created: boolean }> {
  return database.transaction(async (transaction) => {
    const home = (await transaction.query<Home>('SELECT * FROM homes WHERE id = 1 FOR UPDATE')).rows[0];
    if (home.token !== token) throw new AppError(HTTP.notFound, 'INVALID_DOORBELL', 'Este enlace de timbre ya no está disponible.');
    const existing = await transaction.query<PublicVisit>('SELECT id, created_at, answered_at, delivery FROM visits WHERE id = $1', [id]);
    if (existing.rows[0]) return { visit: existing.rows[0], created: false };
    if (!home.enabled) throw new AppError(HTTP.conflict, 'PAUSED', 'El timbre está en pausa. Intentá más tarde.');
    const recent = await transaction.query('SELECT id FROM visits WHERE created_at > NOW() - $1 * INTERVAL \'1 second\' LIMIT 1', [DOORBELL.cooldownSeconds]);
    if (recent.rows.length) throw new AppError(HTTP.tooMany, 'COOLDOWN', 'Ya enviamos un timbrazo hace poco. Esperá 30 segundos.');
    await transaction.query(`DELETE FROM visits WHERE created_at < NOW() - $1 * INTERVAL '1 day'`, [DOORBELL.retentionDays]);
    const result = await transaction.query<PublicVisit>('INSERT INTO visits (id, message) VALUES ($1, $2) RETURNING id, created_at, answered_at, delivery', [id, message]);
    return { visit: result.rows[0], created: true };
  });
}

export async function readVisit(database: Database, token: string, id: string): Promise<PublicVisit> {
  await publicHome(database, token);
  const result = await database.query<PublicVisit>('SELECT id, created_at, answered_at, delivery FROM visits WHERE id = $1', [id]);
  if (!result.rows[0]) throw new AppError(HTTP.notFound, 'VISIT_NOT_FOUND', 'No encontramos este timbrazo.');
  return result.rows[0];
}

/** Repeated acknowledgments preserve the first answer and reject expired visits. */
export async function answerVisit(database: Database, id: string) {
  const result = await database.query<Visit>(`UPDATE visits SET answered_at = COALESCE(answered_at, NOW()) WHERE id = $1 AND (answered_at IS NOT NULL OR created_at > NOW() - $2 * INTERVAL '1 second') RETURNING *`, [id, DOORBELL.responseWindowSeconds]);
  if (!result.rows[0]) throw new AppError(HTTP.conflict, 'VISIT_EXPIRED', 'Este timbrazo ya venció. Podés consultarlo en el historial.');
  return result.rows[0];
}

export async function setDelivery(database: Database, id: string, delivery: DeliveryStatus) {
  await database.query('UPDATE visits SET delivery = $2 WHERE id = $1', [id, delivery]);
}
