import type { Database } from './database';
import { AUTH } from '../constants/auth';

/** Copy verified identity IDs without copying passwords, tokens or managed sessions. */
export async function importVerifiedIdentities(database: Database, schema: string): Promise<number> {
  if (!AUTH.schemaNamePattern.test(schema) || AUTH.reservedSchemas.includes(schema)) throw new Error('IdentityImport: invalid target schema');
  const target = `"${schema}"`;
  return database.transaction(async (transaction) => {
    await transaction.query('LOCK TABLE neon_auth."user" IN SHARE MODE');
    const unsafe = await transaction.query<{ unverified: number; banned: number; organizations: number }>(`SELECT (SELECT COUNT(*)::int FROM neon_auth."user" WHERE "emailVerified" IS NOT TRUE) AS unverified, (SELECT COUNT(*)::int FROM neon_auth."user" WHERE banned IS TRUE) AS banned, (SELECT COUNT(*)::int FROM neon_auth.organization) AS organizations`);
    if (unsafe.rows[0].unverified || unsafe.rows[0].banned || unsafe.rows[0].organizations) throw new Error('IdentityImport: source identities require individual review');
    const collisions = await transaction.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM neon_auth."user" source JOIN ${target}."user" existing ON (source.id = existing.id OR lower(source.email) = lower(existing.email)) WHERE source.id <> existing.id OR lower(source.email) <> lower(existing.email)`);
    if (collisions.rows[0].count) throw new Error('IdentityImport: target identity conflicts with source');
    await transaction.query(`INSERT INTO ${target}."user" AS target (id, name, email, "emailVerified", image, "createdAt", "updatedAt") SELECT id, name, email, "emailVerified", image, "createdAt", "updatedAt" FROM neon_auth."user" ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, "emailVerified" = EXCLUDED."emailVerified", image = EXCLUDED.image, "updatedAt" = EXCLUDED."updatedAt" WHERE target."updatedAt" <= EXCLUDED."updatedAt"`);
    const missing = await transaction.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM neon_auth."user" source WHERE NOT EXISTS (SELECT 1 FROM ${target}."user" target WHERE target.id = source.id AND lower(target.email) = lower(source.email) AND (target."emailVerified" = source."emailVerified" OR target."updatedAt" > source."updatedAt"))`);
    if (missing.rows[0].count) throw new Error('IdentityImport: identity verification failed; transaction rolled back');
    return (await transaction.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM neon_auth."user"')).rows[0].count;
  });
}
