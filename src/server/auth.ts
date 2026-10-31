import { HTTP } from '@/constants/doorbell';
import { ERROR_CODES } from '@/constants/error-codes';
import { getConfig } from './config';
import { AppError } from './errors';
import { getNeonAuth, authConfigured } from './neon-auth';
import { isSelfManagedAuth } from './auth-mode';
import { getSelfAuth } from './self-auth';
import { headers } from 'next/headers';
import { resolveHomeAccess } from './residents';
import { getDatabase } from './database';
import type { ResidentIdentity } from '@/types/auth';
import type { HomeMember } from '@/types/residents';

/** The SDK validates provider sessions; Ringgg never trusts browser-provided user identifiers. */
export async function getIdentity(): Promise<ResidentIdentity | null> {
  if (!authConfigured()) return null;
  if (isSelfManagedAuth()) {
    try {
      // Server components cannot write cookies; the proxy renews the session before the panel renders.
      const session = await getSelfAuth().api.getSession({ headers: await headers(), query: { disableRefresh: true } });
      return session?.user ? { id: session.user.id, email: session.user.email, name: session.user.name, emailVerified: session.user.emailVerified } : null;
    } catch (error) { throw new AppError(HTTP.unavailable, 'AUTH_UPSTREAM', 'No pudimos comprobar tu sesión. Volvé a intentar en un momento.', { cause: error }); }
  }
  const { data, error } = await getNeonAuth().getSession();
  if (error) throw new AppError(HTTP.unavailable, 'AUTH_UPSTREAM', 'No pudimos comprobar tu sesión. Volvé a intentar en un momento.', { cause: error });
  return data?.user ? { id: data.user.id, email: data.user.email, name: data.user.name, emailVerified: data.user.emailVerified } : null;
}

/** A signed-in account with a verified email, before any home is involved. */
export async function requireIdentity(): Promise<ResidentIdentity> {
  if (!authConfigured()) throw new AppError(HTTP.unavailable, 'AUTH_NOT_CONFIGURED', 'El acceso no está disponible en este momento. Intentá más tarde.');
  const user = await getIdentity();
  if (!user) throw new AppError(HTTP.unauthorized, ERROR_CODES.authRequired, 'Ingresá de nuevo para continuar.');
  if (!user.emailVerified) throw new AppError(HTTP.forbidden, 'EMAIL_UNVERIFIED', 'Verificá tu correo para acceder a tu vivienda.');
  return user;
}

/**
 * A verified resident of this home; every resident of a home has the same permissions there. Routes
 * call `requireIdentity` before reading the request, so a request without a session gets 401 whatever
 * it sends, and pass that identity here.
 */
export async function requireHome(user: ResidentIdentity, homeId: number): Promise<HomeMember> {
  return resolveHomeAccess(await getDatabase(), user, homeId);
}

/** Rejects cross-origin mutations, including requests carrying resident cookies. */
export function requireOrigin(request: Request) {
  if (!getConfig().allowedOrigins.includes(request.headers.get('origin') ?? '')) throw new AppError(HTTP.forbidden, 'ORIGIN', 'Abrí el timbre desde su enlace original.');
}
