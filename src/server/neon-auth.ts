import { createNeonAuth } from '@neondatabase/auth/next/server';
import { AUTH } from '@/constants/auth';
import { HTTP } from '@/constants/doorbell';
import { AppError } from './errors';

let auth: ReturnType<typeof createNeonAuth> | undefined;

export function authConfigured(): boolean {
  return Boolean(process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET && process.env.NEON_AUTH_COOKIE_SECRET.length >= AUTH.cookieSecretMinimumLength);
}

/** Lazy initialization allows builds without credentials, while all auth requests fail closed. */
export function getNeonAuth() {
  if (!authConfigured()) throw new AppError(HTTP.unavailable, 'AUTH_NOT_CONFIGURED', 'El acceso no está disponible en este momento. Intentá más tarde.');
  auth ??= createNeonAuth({
    baseUrl: process.env.NEON_AUTH_BASE_URL!,
    cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET!, sessionDataTtl: AUTH.sessionCacheSeconds },
  });
  return auth;
}
