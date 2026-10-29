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

/** Environment administrators are a recoverable bootstrap; future invitations live in PostgreSQL. */
export async function resolveResidentAccess(database: Database, user: ResidentIdentity, settings = residentSettings()): Promise<ResidentAccess> {
  if (!user.emailVerified) authorizeResident(user, '');
  const email = user.email.trim().toLowerCase();
  const isAdmin = emailList(settings.adminEmails).includes(email);
  if (isAdmin || emailList(settings.residentEmails).includes(email)) return { ...user, isAdmin };
  const result = await database.query<{ email: string }>('SELECT email FROM residents WHERE email = $1', [email]);
  authorizeResident(user, result.rows[0]?.email);
  return { ...user, isAdmin: false };
}

export function requireResidentAdmin(user: ResidentAccess) {
  if (!user.isAdmin || !user.emailVerified) throw new AppError(HTTP.forbidden, 'ADMIN_REQUIRED', 'Solo el administrador puede gestionar los residentes.');
}

/** The roster includes protected bootstrap entries and persisted invitations, without disclosing account status. */
export async function listResidents(database: Database, user: ResidentAccess, settings = residentSettings()): Promise<ResidentEntry[]> {
  requireResidentAdmin(user);
  const rows = await database.query<{ email: string }>('SELECT email FROM residents ORDER BY email');
  const entries = new Map<string, ResidentEntry>();
  for (const row of rows.rows) entries.set(row.email, { email: row.email, source: 'invitation', canRemove: true });
  for (const email of emailList(settings.residentEmails)) entries.set(email, { email, source: 'environment', canRemove: false });
  for (const email of emailList(settings.adminEmails)) entries.set(email, { email, source: 'administrator', canRemove: false });
  return [...entries.values()].sort((first, second) => first.email.localeCompare(second.email));
}

/** Repeating an authorization is safe; the home lock prevents concurrent invitations exceeding the limit. */
export async function addResident(database: Database, user: ResidentAccess, input: string): Promise<void> {
  requireResidentAdmin(user);
  const email = residentEmailSchema.parse(input);
  await database.transaction(async (transaction) => {
    await transaction.query('SELECT id FROM homes WHERE id = 1 FOR UPDATE');
    const existing = await transaction.query('SELECT email FROM residents WHERE email = $1', [email]);
    const count = await transaction.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM residents');
    if (!existing.rows.length && Number(count.rows[0].count) >= RESIDENTS.maximumInvitations) throw new AppError(HTTP.conflict, 'RESIDENT_LIMIT', 'Llegaste al límite de 50 residentes. Quitá uno para agregar otro.');
    await transaction.query('INSERT INTO residents (email, invited_by) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING', [email, user.id]);
  });
}

/** Protected bootstrap accounts cannot be removed from the UI, so an admin cannot lock out the home. */
export async function removeResident(database: Database, user: ResidentAccess, input: string, settings = residentSettings()): Promise<void> {
  requireResidentAdmin(user);
  const email = residentEmailSchema.parse(input);
  if (emailList(`${settings.adminEmails},${settings.residentEmails}`).includes(email)) throw new AppError(HTTP.forbidden, 'RESIDENT_PROTECTED', 'Este acceso está protegido por la configuración del servidor y no se puede quitar desde el panel.');
  await database.transaction(async (transaction) => {
    await transaction.query('SELECT id FROM homes WHERE id = 1 FOR UPDATE');
    await transaction.query('DELETE FROM devices WHERE resident_email = $1', [email]);
    await transaction.query('DELETE FROM residents WHERE email = $1', [email]);
  });
}
