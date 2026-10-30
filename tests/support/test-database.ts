import type { PGlite } from '@electric-sql/pglite';
import type { Database } from '../../src/server/database';

/**
 * Real PostgreSQL in memory behind the app's `Database` interface, so tests run the same SQL as
 * production. The app never nests transactions, so a nested one fails loudly.
 */
export function testDatabase(postgres: PGlite): Database {
  return {
    query: (sql, params) => postgres.query(sql, params),
    transaction: (work) => postgres.transaction((transaction) => work({ query: (sql, params) => transaction.query(sql, params), transaction: async () => { throw new Error('Nested transactions are unsupported'); } })),
  };
}
