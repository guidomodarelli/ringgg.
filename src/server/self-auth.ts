import { betterAuth } from 'better-auth';
import { oneTap } from 'better-auth/plugins';
import { PostgresDialect } from 'kysely';
import { createPostgresPool } from './postgres';
import { AppError } from './errors';
import { HTTP } from '@/constants/doorbell';
import { AUTH } from '@/constants/auth';

let auth: ReturnType<typeof createSelfAuth> | undefined;

export function selfAuthConfigured(): boolean {
  const schema = process.env.SELF_AUTH_SCHEMA || AUTH.selfManagedDefaultSchema;
  return Boolean(process.env.SELF_AUTH_DATABASE_URL && process.env.SELF_AUTH_SECRET && process.env.SELF_AUTH_SECRET.length >= AUTH.cookieSecretMinimumLength && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_URL && AUTH.schemaNamePattern.test(schema) && !AUTH.reservedSchemas.includes(schema));
}

/** The isolated schema prevents either auth server from modifying the other's tables. */
function createSelfAuth() {
  const schema = process.env.SELF_AUTH_SCHEMA || AUTH.selfManagedDefaultSchema;
  return betterAuth({
    baseURL: process.env.APP_URL!,
    secret: process.env.SELF_AUTH_SECRET!,
    database: { dialect: new PostgresDialect({ pool: createPostgresPool(process.env.SELF_AUTH_DATABASE_URL!) }), type: 'postgres', schemaName: schema },
    advanced: { database: { generateId: 'uuid' } },
    socialProviders: { google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! } },
    plugins: [oneTap({ clientId: process.env.GOOGLE_CLIENT_ID! })],
  });
}

export function getSelfAuth(): ReturnType<typeof createSelfAuth> {
  if (!selfAuthConfigured()) throw new AppError(HTTP.unavailable, 'AUTH_NOT_CONFIGURED', 'El acceso no está disponible en este momento. Intentá más tarde.');
  return auth ??= createSelfAuth();
}
