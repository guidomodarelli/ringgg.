import { HTTP } from '@/constants/doorbell';
import { getConfig } from './config';
import { AppError } from './errors';
import { getNeonAuth, authConfigured } from './neon-auth';
import { resolveResidentAccess } from './residents';
import { getDatabase } from './database';
import type { ResidentAccess } from '@/types/residents';
import type { ResidentIdentity } from '@/types/auth';

/** The SDK validates provider sessions; Ringgg never trusts browser-provided user identifiers. */
export async function getIdentity(): Promise<ResidentIdentity | null> {
  if (!authConfigured()) return null;
  const { data, error } = await getNeonAuth().getSession();
  if (error) throw new AppError(HTTP.unavailable, 'AUTH_UPSTREAM', 'No pudimos comprobar tu sesión con Neon. Volvé a intentar en un momento.');
  return data?.user ? { id: data.user.id, email: data.user.email, name: data.user.name, emailVerified: data.user.emailVerified } : null;
}

export async function requireAuth(): Promise<ResidentAccess> {
  if (!authConfigured()) throw new AppError(HTTP.unavailable, 'AUTH_NOT_CONFIGURED', 'Neon Auth todavía no está configurado.');
  const user = await getIdentity();
  if (!user) throw new AppError(HTTP.unauthorized, 'AUTH_REQUIRED', 'Ingresá de nuevo para continuar.');
  return resolveResidentAccess(await getDatabase(), user);
}

/** Rejects cross-origin mutations, including requests carrying resident cookies. */
export function requireOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(getConfig().origin).origin) throw new AppError(HTTP.forbidden, 'ORIGIN', 'Abrí el timbre desde su enlace original.');
}
