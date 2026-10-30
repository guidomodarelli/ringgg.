import { z } from 'zod';
import { DOORBELL, HTTP } from '../constants/doorbell';
import { HOMES } from '../constants/homes';
import { cleanName, nameKey } from '../lib/names';
import type { ResidentIdentity } from '../types/auth';
import type { HomeSummary } from '../types/residents';
import type { Database } from './database';
import { AppError } from './errors';
import { listResidentHomes, listResidents, resolveHomeAccess, residentSettings } from './residents';

/** Home ids arrive as JSON numbers or query strings. */
export const homeIdSchema = z.coerce.number().int().positive();
/** Required, without surrounding spaces. */
export const homeNameSchema = z.string().transform(cleanName).pipe(z.string().min(1).max(DOORBELL.nameMaxLength));

function homeNameTaken(name: string) {
  return new AppError(HTTP.conflict, 'HOME_NAME_TAKEN', `Ya tenés una casa llamada «${name}». Elegí otro nombre.`);
}

/** A resident's homes never share a name, so the home switcher never shows two identical entries. */
export function requireFreeHomeName(homes: HomeSummary[], name: string, exceptHomeId: number | null = null) {
  if (homes.some((home) => home.id !== exceptHomeId && nameKey(home.name) === nameKey(name))) throw homeNameTaken(name);
}

/**
 * Residents of at least one home can create more, up to a limit: the app stays closed to accounts
 * nobody invited. The creator joins with the name they use in their other homes.
 */
export async function createHome(database: Database, user: ResidentIdentity, input: string, settings = residentSettings()): Promise<{ id: number }> {
  const name = homeNameSchema.parse(input);
  const email = user.email.trim().toLowerCase();
  return database.transaction(async (transaction) => {
    // Serializes the creations of one resident, so two requests cannot both pass the limit.
    await transaction.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ringgg-homes:${email}`]);
    const homes = await listResidentHomes(transaction, user, settings);
    if (!homes.length) throw new AppError(HTTP.forbidden, 'HOME_CREATION_NOT_ALLOWED', 'Para crear una casa, primero tenés que ser residente de alguna.');
    if (homes.length >= HOMES.maxPerResident) throw new AppError(HTTP.conflict, 'HOME_LIMIT', `Llegaste al límite de ${HOMES.maxPerResident} casas.`);
    requireFreeHomeName(homes, name);
    const created = await transaction.query<{ id: number }>('INSERT INTO homes (name, token) VALUES ($1, $2) RETURNING id', [name, crypto.randomUUID()]);
    const [home] = created.rows;
    const known = await transaction.query<{ display_name: string; display_key: string }>('SELECT display_name, display_key FROM home_members WHERE email = $1 AND display_name IS NOT NULL ORDER BY created_at DESC LIMIT 1', [email]);
    const [identity] = known.rows;
    await transaction.query('INSERT INTO home_members (home_id, email, invited_by, display_name, display_key) VALUES ($1, $2, $3, $4, $5)', [home.id, email, user.id, identity?.display_name ?? null, identity?.display_key ?? null]);
    return { id: home.id };
  });
}

/**
 * Deletes a home with its visits, residents and device registrations. Only its sole resident can, and
 * only while they keep another home: nobody deletes a home others use, and nobody ends up without one.
 */
export async function deleteHome(database: Database, user: ResidentIdentity, homeId: number, settings = residentSettings()): Promise<{ nextHomeId: number }> {
  return database.transaction(async (transaction) => {
    await transaction.query('SELECT id FROM homes WHERE id = $1 FOR UPDATE', [homeId]);
    await resolveHomeAccess(transaction, user, homeId, settings);
    if ((await listResidents(transaction, homeId, settings)).length > 1) throw new AppError(HTTP.conflict, 'HOME_HAS_RESIDENTS', 'Solo podés eliminar una casa en la que seas el único residente. Si los demás la siguen usando, salí de la casa desde Residentes.');
    const next = (await listResidentHomes(transaction, user, settings)).find((home) => home.id !== homeId);
    if (!next) throw new AppError(HTTP.conflict, 'LAST_HOME', 'Es tu única casa, así que no se puede eliminar.');
    await transaction.query('DELETE FROM homes WHERE id = $1', [homeId]);
    await transaction.query('DELETE FROM devices d WHERE d.resident_email = $1 AND NOT EXISTS (SELECT 1 FROM device_homes dh WHERE dh.device_id = d.id)', [user.email.trim().toLowerCase()]);
    return { nextHomeId: next.id };
  });
}
