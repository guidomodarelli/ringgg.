import { z } from 'zod';
import type { Database } from './database';
import type { ResidentIdentity } from '../types/auth';
import type { HomeMember, HomeSummary, ResidentEntry, ResidentSettings } from '../types/residents';
import { RESIDENTS } from '../constants/residents';
import { HOMES, RESIDENT_NAMES } from '../constants/homes';
import { HTTP } from '../constants/doorbell';
import { AppError } from './errors';
import { authorizeResident } from './resident-access';
import { renameDefaultDevices } from './device-names';
import { cleanName, nameKey } from '../lib/names';
import type { Environment } from '../types/environment';

const UNIQUE_VIOLATION = '23505';

export const residentEmailSchema = z.string().trim().max(RESIDENTS.emailMaxLength).check(z.email()).transform((email) => email.toLowerCase());
/** Required: an empty or blank name is rejected, and so is one longer than "iPhone de <nombre>" allows. */
export const residentNameSchema = z.string().transform(cleanName).pipe(z.string().min(1).max(RESIDENT_NAMES.maxLength));

function normalizedEmail(email: string) { return email.trim().toLowerCase(); }
function emailList(value: string | undefined) { return (value || '').split(',').map(normalizedEmail).filter(Boolean); }

/** Both variables seed the same shared access to the original home; `RESIDENT_ADMIN_EMAILS` remains accepted for existing deployments. */
export function residentSettings(env: Environment = process.env): ResidentSettings {
  return { bootstrapEmails: [...new Set([...emailList(env.RESIDENT_ADMIN_EMAILS), ...emailList(env.RESIDENT_EMAILS)])] };
}

/** The account's own name, or the email's local part: only a suggestion until the resident chooses a name. */
export function accountName(user: Pick<ResidentIdentity, 'name' | 'email'>) {
  return user.name?.trim() || user.email.split('@')[0];
}

/** Name of a resident in a home: the one they chose there, or their account name until they choose. */
export function memberName(member: HomeMember) {
  return member.displayName ?? accountName(member);
}

/** A resident of one home, by email: whom an operation adds, removes or renames. */
export interface ResidentTarget { homeId: number; email: string }

function isBootstrap(homeId: number, email: string, settings: ResidentSettings) {
  return homeId === HOMES.originalId && settings.bootstrapEmails.includes(email);
}

/**
 * Every verified resident of a home has the same permissions there (shared management). Access comes
 * from an invitation to that home or, in the original home, from a bootstrap email, unless revoked.
 */
export async function resolveHomeAccess(database: Database, user: ResidentIdentity, homeId: number, settings = residentSettings()): Promise<HomeMember> {
  if (!user.emailVerified) authorizeResident(user, '');
  const email = normalizedEmail(user.email);
  const result = await database.query<{ home_exists: boolean; member: boolean; display_name: string | null; revoked: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM homes WHERE id = $1) AS home_exists, m.email IS NOT NULL AS member, m.display_name,
            EXISTS(SELECT 1 FROM home_revocations WHERE home_id = $1 AND email = $2) AS revoked
     FROM (SELECT 1) AS anchor LEFT JOIN home_members m ON m.home_id = $1 AND m.email = $2`,
    [homeId, email],
  );
  const [row] = result.rows;
  const allowed = row.home_exists && !row.revoked && (row.member || isBootstrap(homeId, email, settings));
  authorizeResident(user, allowed ? email : undefined);
  return { ...user, homeId, displayName: row.display_name };
}

/** The homes a verified resident can open, in creation order. */
export async function listResidentHomes(database: Database, user: ResidentIdentity, settings = residentSettings()): Promise<HomeSummary[]> {
  if (!user.emailVerified) return [];
  const email = normalizedEmail(user.email);
  const result = await database.query<HomeSummary>(
    `SELECT h.id, h.name FROM homes h
     WHERE (EXISTS (SELECT 1 FROM home_members m WHERE m.home_id = h.id AND m.email = $1) OR (h.id = $2 AND $3::boolean))
       AND NOT EXISTS (SELECT 1 FROM home_revocations r WHERE r.home_id = h.id AND r.email = $1)
     ORDER BY h.id`,
    [email, HOMES.originalId, settings.bootstrapEmails.includes(email)],
  );
  return result.rows;
}

/** Prefill for "¿Quién sos?": the name the resident chose most recently in another home, else the account name. */
export async function suggestedResidentName(database: Database, user: ResidentIdentity) {
  const result = await database.query<{ display_name: string }>('SELECT display_name FROM home_members WHERE email = $1 AND display_name IS NOT NULL ORDER BY created_at DESC LIMIT 1', [normalizedEmail(user.email)]);
  return result.rows[0]?.display_name ?? accountName(user);
}

/** The roster of a home: its members and, in the original home, the bootstrap emails, minus revocations. */
export async function listResidents(database: Database, homeId: number, settings = residentSettings()): Promise<ResidentEntry[]> {
  const rows = await database.query<{ email: string; display_name: string | null }>('SELECT email, display_name FROM home_members WHERE home_id = $1', [homeId]);
  const revoked = await database.query<{ email: string }>('SELECT email FROM home_revocations WHERE home_id = $1', [homeId]);
  const entries = new Map<string, Omit<ResidentEntry, 'email' | 'canRemove'>>();
  for (const row of rows.rows) entries.set(row.email, { name: row.display_name, source: 'invitation' });
  if (homeId === HOMES.originalId) for (const email of settings.bootstrapEmails) entries.set(email, { name: entries.get(email)?.name ?? null, source: 'environment' });
  for (const row of revoked.rows) entries.delete(row.email);
  const roster = [...entries].map(([email, entry]) => ({ email, ...entry })).sort((first, second) => (first.name ?? first.email).localeCompare(second.name ?? second.email));
  // Any resident can be removed while another one remains, so the home never loses every resident.
  return roster.map((entry) => ({ ...entry, canRemove: roster.length > 1 }));
}

async function lockHome(database: Database, homeId: number) {
  await database.query('SELECT id FROM homes WHERE id = $1 FOR UPDATE', [homeId]);
}

/**
 * Rollback compatibility: the single-home version reads access only from `residents` and
 * `resident_revocations`, which migration 4 keeps. While that rollback stays supported, every access
 * change in the original home is mirrored there in the caller's transaction, and other homes never touch
 * them. A revocation also keeps out bootstrap emails, which that version accepts from the environment.
 */
export async function mirrorLegacyRevocation(database: Database, target: ResidentTarget) {
  if (target.homeId !== HOMES.originalId) return;
  await database.query('DELETE FROM residents WHERE email = $1', [target.email]);
  await database.query('INSERT INTO resident_revocations (email) VALUES ($1) ON CONFLICT (email) DO NOTHING', [target.email]);
}

/** Authorization counterpart of `mirrorLegacyRevocation`: invites the email and lifts its revocation. */
async function mirrorLegacyAuthorization(database: Database, target: ResidentTarget, invitedBy: string) {
  if (target.homeId !== HOMES.originalId) return;
  await database.query('DELETE FROM resident_revocations WHERE email = $1', [target.email]);
  await database.query('INSERT INTO residents (email, invited_by) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING', [target.email, invitedBy]);
}

/** Repeating an authorization is safe; the home lock prevents concurrent invitations exceeding the limit. */
export async function addResident(database: Database, user: ResidentIdentity, target: ResidentTarget, settings = residentSettings()): Promise<void> {
  const email = residentEmailSchema.parse(target.email);
  const { homeId } = target;
  await database.transaction(async (transaction) => {
    await lockHome(transaction, homeId);
    await resolveHomeAccess(transaction, user, homeId, settings);
    const existing = await transaction.query('SELECT email FROM home_members WHERE home_id = $1 AND email = $2', [homeId, email]);
    const count = await transaction.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM home_members WHERE home_id = $1', [homeId]);
    if (!existing.rows.length && count.rows[0].count >= RESIDENTS.maximumInvitations) throw new AppError(HTTP.conflict, 'RESIDENT_LIMIT', `Llegaste al límite de ${RESIDENTS.maximumInvitations} residentes. Quitá uno para agregar otro.`);
    await transaction.query('DELETE FROM home_revocations WHERE home_id = $1 AND email = $2', [homeId, email]);
    await transaction.query('INSERT INTO home_members (home_id, email, invited_by) VALUES ($1, $2, $3) ON CONFLICT (home_id, email) DO NOTHING', [homeId, email, user.id]);
    await mirrorLegacyAuthorization(transaction, { homeId, email }, user.id);
  });
}

/** Any resident can be removed while another one remains; only their devices of this home stop ringing. */
export async function removeResident(database: Database, user: ResidentIdentity, target: ResidentTarget, settings = residentSettings()): Promise<void> {
  const email = residentEmailSchema.parse(target.email);
  const { homeId } = target;
  await database.transaction(async (transaction) => {
    await lockHome(transaction, homeId);
    await resolveHomeAccess(transaction, user, homeId, settings);
    const roster = await listResidents(transaction, homeId, settings);
    if (!roster.some((entry) => entry.email === email)) return;
    if (roster.length <= 1) throw new AppError(HTTP.conflict, 'LAST_RESIDENT', 'La vivienda necesita al menos un residente autorizado.');
    await transaction.query('DELETE FROM device_homes WHERE home_id = $1 AND device_id IN (SELECT id FROM devices WHERE resident_email = $2)', [homeId, email]);
    await transaction.query('DELETE FROM devices d WHERE d.resident_email = $1 AND NOT EXISTS (SELECT 1 FROM device_homes dh WHERE dh.device_id = d.id)', [email]);
    await transaction.query('DELETE FROM home_members WHERE home_id = $1 AND email = $2', [homeId, email]);
    await transaction.query('INSERT INTO home_revocations (home_id, email) VALUES ($1, $2) ON CONFLICT (home_id, email) DO NOTHING', [homeId, email]);
    await mirrorLegacyRevocation(transaction, { homeId, email });
  });
}

function nameTaken(name: string): AppError {
  return new AppError(HTTP.conflict, 'RESIDENT_NAME_TAKEN', `Ya hay alguien llamado «${name}» en esta casa. Elegí otro nombre.`);
}

/**
 * Sets how a home calls one of its residents: themselves the first time ("¿Quién sos?") or anyone of
 * the home afterwards. Names are required and unique in the home regardless of case, accents or spaces.
 * The first name also replaces the default name of that resident's devices in the home.
 */
export async function renameResident(database: Database, user: ResidentIdentity, target: ResidentTarget & { name: string }, settings = residentSettings()): Promise<void> {
  const email = residentEmailSchema.parse(target.email);
  const { homeId } = target;
  const name = residentNameSchema.parse(target.name);
  try {
    await database.transaction(async (transaction) => {
      await lockHome(transaction, homeId);
      await resolveHomeAccess(transaction, user, homeId, settings);
      const roster = await listResidents(transaction, homeId, settings);
      const resident = roster.find((entry) => entry.email === email);
      if (!resident) throw new AppError(HTTP.notFound, 'RESIDENT_NOT_FOUND', 'Esa persona ya no es residente de esta casa. Actualizá la lista.');
      if (roster.some((entry) => entry.email !== email && entry.name !== null && nameKey(entry.name) === nameKey(name))) throw nameTaken(name);
      await transaction.query(
        `INSERT INTO home_members (home_id, email, invited_by, display_name, display_key) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (home_id, email) DO UPDATE SET display_name = EXCLUDED.display_name, display_key = EXCLUDED.display_key`,
        [homeId, email, resident.source, name, nameKey(name)],
      );
      if (resident.name === null) await renameDefaultDevices(transaction, homeId, email, name);
    });
  } catch (error) {
    // The unique index is the backstop if two residents save the same name at once.
    if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) throw nameTaken(name);
    throw error;
  }
}
