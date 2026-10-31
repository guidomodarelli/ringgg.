import { betterAuth } from 'better-auth';
import { oneTap } from 'better-auth/plugins';
import { PostgresDialect } from 'kysely';
import { createPostgresPool } from './postgres';
import { AppError } from './errors';
import { HTTP } from '@/constants/doorbell';
import { AUTH } from '@/constants/auth';
import type { Environment } from '@/types/environment';

/** Everything the self-managed auth server needs, read once from the environment. */
export interface SelfAuthSettings { baseUrl: string; secret: string; databaseUrl: string; googleClientId: string; googleClientSecret: string; schema: string }

/** The self-managed auth configuration, or `null` while a variable is missing or invalid. */
export function selfAuthSettings(env: Environment = process.env): SelfAuthSettings | null {
  const schema = env.SELF_AUTH_SCHEMA || AUTH.selfManagedDefaultSchema;
  const { APP_URL: baseUrl, SELF_AUTH_SECRET: secret, SELF_AUTH_DATABASE_URL: databaseUrl, GOOGLE_CLIENT_ID: googleClientId, GOOGLE_CLIENT_SECRET: googleClientSecret } = env;
  if (!databaseUrl || !secret || secret.length < AUTH.cookieSecretMinimumLength || !googleClientId || !googleClientSecret || !baseUrl || !AUTH.schemaNamePattern.test(schema) || AUTH.reservedSchemas.includes(schema)) return null;
  return { baseUrl, secret, databaseUrl, googleClientId, googleClientSecret, schema };
}

export function selfAuthConfigured(): boolean {
  return selfAuthSettings() !== null;
}

/**
 * The isolated schema prevents either auth server from modifying the other's tables. A session in use is
 * renewed once `updateAge` passes: by API routes, and by the proxy before a page renders.
 */
function createSelfAuth(settings: SelfAuthSettings) {
  return betterAuth({
    baseURL: settings.baseUrl,
    secret: settings.secret,
    database: { dialect: new PostgresDialect({ pool: createPostgresPool(settings.databaseUrl) }), type: 'postgres', schemaName: settings.schema },
    session: { expiresIn: AUTH.sessionLifetimeSeconds, updateAge: AUTH.sessionRenewalSeconds },
    advanced: { database: { generateId: 'uuid' } },
    socialProviders: { google: { clientId: settings.googleClientId, clientSecret: settings.googleClientSecret } },
    plugins: [oneTap({ clientId: settings.googleClientId })],
  });
}

let auth: ReturnType<typeof createSelfAuth> | undefined;

export function getSelfAuth(): ReturnType<typeof createSelfAuth> {
  const settings = selfAuthSettings();
  if (!settings) throw new AppError(HTTP.unavailable, 'AUTH_NOT_CONFIGURED', 'El acceso no está disponible en este momento. Intentá más tarde.');
  auth ??= createSelfAuth(settings);
  return auth;
}
