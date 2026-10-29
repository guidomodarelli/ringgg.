import { PGlite } from '@electric-sql/pglite';
import { createPostgresPool } from './postgres';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface Database {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(work: (database: Database) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

/** Both adapters execute PostgreSQL SQL; local storage must never be used on Vercel. */
async function connect(): Promise<Database> {
  if (process.env.DATABASE_URL) {
    const pool = createPostgresPool(process.env.DATABASE_URL);
    return {
      close: () => pool.end(),
      async query<T>(sql: string, params: unknown[] = []) { const result = await pool.query(sql, params); return { rows: result.rows as T[] }; },
      async transaction<T>(work: (database: Database) => Promise<T>) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await work({ query: async <Row>(sql: string, params?: unknown[]) => { const response = await client.query(sql, params); return { rows: response.rows as Row[] }; }, transaction: async () => { throw new Error('Nested database transactions are unsupported'); } });
          await client.query('COMMIT');
          return result;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      },
    };
  }
  if (process.env.VERCEL) throw new Error('Database: DATABASE_URL is required on Vercel');
  const directory = resolve(/* turbopackIgnore: true */ process.env.LOCAL_DATABASE_PATH || '.data/postgres');
  await mkdir(directory, { recursive: true });
  const local = new PGlite(directory);
  return {
    close: () => local.close(),
    query: (sql, params) => local.query(sql, params),
    transaction: (work) => local.transaction((transaction) => work({ query: (sql, params) => transaction.query(sql, params), transaction: async () => { throw new Error('Nested database transactions are unsupported'); } })),
  };
}

/** Idempotent bootstrap is also used by integration tests with a real database. */
export async function initialize(database: Database) {
  await database.query(`CREATE TABLE IF NOT EXISTS homes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL UNIQUE, enabled BOOLEAN NOT NULL DEFAULT TRUE)`);
  await database.query(`INSERT INTO homes (id, name, token) VALUES (1, 'Mi casa', $1) ON CONFLICT (id) DO NOTHING`, [crypto.randomUUID()]);
  await database.query(`CREATE TABLE IF NOT EXISTS residents (email TEXT PRIMARY KEY, invited_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await database.query(`CREATE TABLE IF NOT EXISTS resident_revocations (email TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await database.query(`CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE, subscription JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await database.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS resident_email TEXT`);
  await database.query(`CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY, message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), answered_at TIMESTAMPTZ, delivery TEXT NOT NULL DEFAULT 'registered')`);
  await database.query(`CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`);
  await database.query(`CREATE INDEX IF NOT EXISTS visits_created_at_idx ON visits (created_at DESC)`);
}

const databaseGlobal = globalThis as unknown as { ringggDatabase?: Promise<Database> };
export function getDatabase(): Promise<Database> {
  databaseGlobal.ringggDatabase ??= connect().then(async (database) => {
    try { await initialize(database); return database; }
    catch (error) { await database.close?.(); throw error; }
  }).catch((error) => {
    // A temporary Neon wake-up or network failure must not poison this server instance forever.
    databaseGlobal.ringggDatabase = undefined;
    throw error;
  });
  return databaseGlobal.ringggDatabase;
}
