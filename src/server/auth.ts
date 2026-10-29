import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { SESSION, HTTP } from '@/constants/doorbell';
import { getConfig } from './config';
import { AppError } from './errors';
import { getDatabase } from './database';

export function matchesPassword(password: string): boolean {
  return timingSafeEqual(createHash('sha256').update(password).digest(), createHash('sha256').update(getConfig().password).digest());
}
export function createSession(): string {
  const expiration = String(Math.floor(Date.now() / 1000) + SESSION.lifetimeSeconds);
  return `${expiration}.${createHmac('sha256', getConfig().secret).update(expiration).digest('hex')}`;
}
export function validSession(token: string): boolean {
  const [expiration, signature] = token.split('.');
  if (!expiration || !signature || Number(expiration) <= Date.now() / 1000) return false;
  const expected = createHmac('sha256', getConfig().secret).update(expiration).digest('hex');
  return Buffer.byteLength(signature) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
export async function authenticated(): Promise<boolean> { return validSession((await cookies()).get(SESSION.cookie)?.value || ''); }
export async function requireAuth() { if (!(await authenticated())) throw new AppError(HTTP.unauthorized, 'AUTH_REQUIRED', 'Ingresá de nuevo para continuar.'); }

/** Rejects cross-origin mutations, including requests carrying resident cookies. */
export function requireOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(getConfig().origin).origin) throw new AppError(HTTP.forbidden, 'ORIGIN', 'Abrí el timbre desde su enlace original.');
}

/** A shared DB-backed attempt limit works across serverless instances. */
export async function limitLogin(request: Request) {
  const database = await getDatabase();
  const address = process.env.VERCEL ? request.headers.get('x-vercel-forwarded-for') || 'unknown' : 'local';
  const key = `login:${createHash('sha256').update(address).digest('hex')}`;
  const result = await database.query<{ attempts: number }>(`INSERT INTO rate_limits (key, attempts, expires_at) VALUES ($1, 1, NOW() + $2 * INTERVAL '1 second') ON CONFLICT (key) DO UPDATE SET attempts = CASE WHEN rate_limits.expires_at < NOW() THEN 1 ELSE rate_limits.attempts + 1 END, expires_at = CASE WHEN rate_limits.expires_at < NOW() THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END RETURNING attempts`, [key, SESSION.loginWindowSeconds]);
  if (result.rows[0].attempts > SESSION.maxLoginAttempts) throw new AppError(HTTP.tooMany, 'LOGIN_LIMIT', 'Demasiados intentos. Volvé a probar en 15 minutos.');
}
