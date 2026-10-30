import { createNeonAuth } from '@neondatabase/auth/next/server';
import { AUTH } from '@/constants/auth';
import { HTTP } from '@/constants/doorbell';
import type { Environment } from '@/types/environment';
import { AppError } from './errors';
import { isSelfManagedAuth } from './auth-mode';
import { selfAuthConfigured } from './self-auth';

let auth: ReturnType<typeof createNeonAuth> | undefined;

interface NeonAuthSettings { baseUrl: string; cookieSecret: string }

/** The managed Neon Auth configuration, or `null` while a variable is missing or the secret is too short. */
function neonAuthSettings(env: Environment = process.env): NeonAuthSettings | null {
  const { NEON_AUTH_BASE_URL: baseUrl, NEON_AUTH_COOKIE_SECRET: cookieSecret } = env;
  if (!baseUrl || !cookieSecret || cookieSecret.length < AUTH.cookieSecretMinimumLength) return null;
  return { baseUrl, cookieSecret };
}

export function authConfigured(): boolean {
  if (isSelfManagedAuth()) return selfAuthConfigured();
  return neonAuthSettings() !== null;
}

/** Lazy initialization allows builds without credentials, while all auth requests fail closed. */
export function getNeonAuth() {
  const settings = isSelfManagedAuth() ? null : neonAuthSettings();
  if (!settings) throw new AppError(HTTP.unavailable, 'AUTH_NOT_CONFIGURED', 'El acceso no está disponible en este momento. Intentá más tarde.');
  auth ??= createNeonAuth({
    baseUrl: settings.baseUrl,
    cookies: { secret: settings.cookieSecret, sessionDataTtl: AUTH.sessionCacheSeconds },
  });
  return auth;
}
