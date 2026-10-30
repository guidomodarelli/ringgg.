import type { Database } from '../../src/server/database';

/**
 * Access as the single-home version reads it after a rollback: the emails invited in `residents` and the
 * ones revoked in `resident_revocations`, sorted.
 */
export async function legacyAccess(database: Database) {
  const invited = await database.query<{ email: string }>('SELECT email FROM residents ORDER BY email');
  const revoked = await database.query<{ email: string }>('SELECT email FROM resident_revocations ORDER BY email');
  return { invited: invited.rows.map((row) => row.email), revoked: revoked.rows.map((row) => row.email) };
}
