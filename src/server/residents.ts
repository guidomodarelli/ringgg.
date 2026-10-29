import { z } from 'zod';
import type { Database } from './database';
import type { ResidentIdentity } from '../types/auth';
import type { ResidentAccess, ResidentEntry, ResidentSettings } from '../types/residents';
import { RESIDENTS } from '../constants/residents';
import { HTTP } from '../constants/doorbell';
import { AppError } from './errors';
import { authorizeResident } from './resident-access';

export const residentEmailSchema = z.string().trim().max(RESIDENTS.emailMaxLength).email().transform((email) => email.toLowerCase());

function emailList(value: string) { return value.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean); }

export function residentSettings(): ResidentSettings {
  return { adminEmails: process.env.RESIDENT_ADMIN_EMAILS || '', residentEmails: process.env.RESIDENT_EMAILS || '' };
}

/** Every verified resident has the same permissions, including a bootstrap email unless explicitly revoked. */
export async function resolveResidentAccess(database: Database, user: ResidentIdentity, settings = residentSettings()): Promise<ResidentAccess> {
  if (!user.emailVerified) authorizeResident(user, '');
  const email = user.email.trim().toLowerCase();
  const configured = emailList(`${settings.adminEmails},${settings.residentEmails}`).includes(email);
  const result = await database.query<{ invited: boolean; revoked: boolean }>('SELECT EXISTS(SELECT 1 FROM residents WHERE email = $1) AS invited, EXISTS(SELECT 1 FROM resident_revocations WHERE email = $1) AS revoked', [email]);
  const allowed = !result.rows[0].revoked && (configured || result.rows[0].invited);
  authorizeResident(user, allowed ? email : undefined);
  return { ...user, isAdmin: true };
}

export function requireResidentAdmin(user: ResidentAccess) {
  if (!user.isAdmin || !user.emailVerified) throw new AppError(HTTP.forbidden, 'ADMIN_REQUIRED', 'Solo el administrador puede gestionar los residentes.');
}

/** The roster includes protected bootstrap entries and persisted invitations, without disclosing account status. */
export async function listResidents(database: Database, user: ResidentAccess, settings = residentSettings()): Promise<ResidentEntry[]> {
  requireResidentAdmin(user);
  const rows = await database.query<{ email: string }>('SELECT email FROM residents ORDER BY email');
  const revoked = await database.query<{ email: string }>('SELECT email FROM resident_revocations');
  const entries = new Map<string, ResidentEntry>();
  for (const row of rows.rows) entries.set(row.email, { email: row.email, source: 'invitation', canRemove: true });
  for (const email of emailList(settings.residentEmails)) entries.set(email, { email, source: 'environment', canRemove: false });
  for (const email of emailList(settings.adminEmails)) entries.set(email, { email, source: 'administrator', canRemove: false });
  for (const row of revoked.rows) entries.delete(row.email);
  const roster = [...entries.values()].sort((first, second) => first.email.localeCompare(second.email));
  return roster.map((entry) => ({ ...entry, canRemove: roster.length > 1 }));
}

/** Repeating an authorization is safe; the home lock prevents concurrent invitations exceeding the limit. */
export async function addResident(database: Database, user: ResidentAccess, input: string, settings = residentSettings()): Promise<void> {
  requireResidentAdmin(user);
  const email = residentEmailSchema.parse(input);
  await database.transaction(async (transaction) => {
    await transaction.query('SELECT id FROM homes WHERE id = 1 FOR UPDATE');
    requireResidentAdmin(await resolveResidentAccess(transaction, user, settings));
    const existing = await transaction.query('SELECT email FROM residents WHERE email = $1', [email]);
    const count = await transaction.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM residents');
    if (!existing.rows.length && Number(count.rows[0].count) >= RESIDENTS.maximumInvitations) throw new AppError(HTTP.conflict, 'RESIDENT_LIMIT', 'Llegaste al límite de 50 residentes. Quitá uno para agregar otro.');
    await transaction.query('DELETE FROM resident_revocations WHERE email = $1', [email]);
    await transaction.query('INSERT INTO residents (email, invited_by) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING', [email, user.id]);
  });
}

/** Any resident can be removed while at least one authorized resident remains. */
export async function removeResident(database: Database, user: ResidentAccess, input: string, settings = residentSettings()): Promise<void> {
  requireResidentAdmin(user);
  const email = residentEmailSchema.parse(input);
  await database.transaction(async (transaction) => {
    await transaction.query('SELECT id FROM homes WHERE id = 1 FOR UPDATE');
    const actor = await resolveResidentAccess(transaction, user, settings);
    requireResidentAdmin(actor);
    const roster = await listResidents(transaction, actor, settings);
    if (!roster.some((entry) => entry.email === email)) return;
    if (roster.length <= 1) throw new AppError(HTTP.conflict, 'LAST_RESIDENT', 'La vivienda necesita al menos un residente autorizado.');
    await transaction.query('DELETE FROM devices WHERE resident_email = $1', [email]);
    await transaction.query('DELETE FROM residents WHERE email = $1', [email]);
    await transaction.query('INSERT INTO resident_revocations (email) VALUES ($1) ON CONFLICT (email) DO NOTHING', [email]);
  });
}
