import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { createPostgresPool } from './postgres';
import { logError } from './errors';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEVICES } from '../constants/devices';
import { HOMES } from '../constants/homes';
import { nameKey, uniqueName } from '../lib/names';

/** Rows of a query, typed by the caller after the columns it selects. */
export interface QueryResult<Row> { rows: Row[] }

export interface Database {
  query<Row>(sql: string, params?: unknown[]): Promise<QueryResult<Row>>;
  transaction<T>(work: (database: Database) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

function nestedTransaction(): never {
  throw new Error('Database: nested transactions are unsupported');
}

/**
 * Adapts a `pg` pool. A failed ROLLBACK never hides the original error, and the client it ran on is
 * discarded instead of returning a broken connection to the pool.
 */
export function poolDatabase(pool: Pool): Database {
  return {
    close: () => pool.end(),
    async query<Row>(sql: string, params: unknown[] = []): Promise<QueryResult<Row>> { const result = await pool.query(sql, params); return { rows: result.rows as Row[] }; },
    async transaction<T>(work: (database: Database) => Promise<T>) {
      const client = await pool.connect();
      let brokenConnection: Error | undefined;
      try {
        await client.query('BEGIN');
        const result = await work({
          query: async <Row>(sql: string, params?: unknown[]): Promise<QueryResult<Row>> => { const response = await client.query(sql, params); return { rows: response.rows as Row[] }; },
          transaction: async () => nestedTransaction(),
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); }
        catch (rollbackError) {
          brokenConnection = rollbackError instanceof Error ? rollbackError : new Error('Database: rollback failed', { cause: rollbackError });
          logError('database.transaction.rollback', rollbackError);
        }
        throw error;
      } finally { client.release(brokenConnection); }
    },
  };
}

/** Both adapters execute PostgreSQL SQL; local storage must never be used on Vercel. */
async function connect(): Promise<Database> {
  if (process.env.DATABASE_URL) return poolDatabase(createPostgresPool(process.env.DATABASE_URL));
  if (process.env.VERCEL) throw new Error('Database: DATABASE_URL is required on Vercel');
  const directory = resolve(/* turbopackIgnore: true */ process.env.LOCAL_DATABASE_PATH || '.data/postgres');
  await mkdir(directory, { recursive: true });
  const local = new PGlite(directory);
  return {
    close: () => local.close(),
    query: (sql, params) => local.query(sql, params),
    transaction: (work) => local.transaction((transaction) => work({ query: (sql, params) => transaction.query(sql, params), transaction: async () => nestedTransaction() })),
  };
}

/** A SQL statement, a statement whose parameters are computed when it runs, or a step that reads the data. */
type MigrationStep = string | [string, () => unknown[]] | ((database: Database) => Promise<void>);
type Migration = MigrationStep[];

/**
 * Existing devices keep ringing for the original home. Names repeated inside it get a numeric suffix, so
 * the unique index on the home's device names can be created.
 */
async function assignDevicesToOriginalHome(database: Database) {
  const devices = await database.query<{ id: string; name: string }>('SELECT id, name FROM devices ORDER BY created_at, id');
  const taken: string[] = [];
  for (const device of devices.rows) {
    const name = uniqueName(device.name || DEVICES.defaultName, taken, DEVICES.nameMaxLength);
    taken.push(name);
    await database.query('INSERT INTO device_homes (device_id, home_id, name, name_key) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [device.id, HOMES.originalId, name, nameKey(name)]);
  }
}

/**
 * Ordered schema versions. Version 1 is the original bootstrap, written with IF NOT EXISTS so
 * databases created before versioning adopt it without changes. Only append new versions.
 */
export const MIGRATIONS: Migration[] = [
  [
    `CREATE TABLE IF NOT EXISTS homes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL UNIQUE, enabled BOOLEAN NOT NULL DEFAULT TRUE)`,
    [`INSERT INTO homes (id, name, token) VALUES (1, 'Mi casa', $1) ON CONFLICT (id) DO NOTHING`, () => [crypto.randomUUID()]],
    `CREATE TABLE IF NOT EXISTS residents (email TEXT PRIMARY KEY, invited_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS resident_revocations (email TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE, subscription JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS resident_email TEXT`,
    `CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY, message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), answered_at TIMESTAMPTZ, delivery TEXT NOT NULL DEFAULT 'registered')`,
    `CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS visits_created_at_idx ON visits (created_at DESC)`,
  ],
  [
    `ALTER TABLE visits ADD COLUMN IF NOT EXISTS reply TEXT`,
    `ALTER TABLE visits ADD COLUMN IF NOT EXISTS answered_by TEXT`,
    `ALTER TABLE visits ADD COLUMN IF NOT EXISTS note TEXT`,
    `ALTER TABLE visits ADD COLUMN IF NOT EXISTS noted_at TIMESTAMPTZ`,
    `ALTER TABLE homes ADD COLUMN IF NOT EXISTS quiet_start TEXT`,
    `ALTER TABLE homes ADD COLUMN IF NOT EXISTS quiet_end TEXT`,
    `CREATE INDEX IF NOT EXISTS rate_limits_expires_at_idx ON rate_limits (expires_at)`,
  ],
  [
    // Timed pauses, device owners and delivery health, and receipts confirmed by each device's service worker.
    `ALTER TABLE homes ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS owner_name TEXT`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_failure_status INTEGER`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_received_at TIMESTAMPTZ`,
    `CREATE TABLE IF NOT EXISTS visit_receipts (visit_id TEXT NOT NULL REFERENCES visits (id) ON DELETE CASCADE, device_id TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (visit_id, device_id))`,
  ],
  [
    // Several homes per resident. Additive on purpose: the previous deployment keeps working on the
    // original home after a rollback (legacy `residents` tables stay, `visits.home_id` defaults to it).
    `CREATE SEQUENCE IF NOT EXISTS homes_id_seq OWNED BY homes.id`,
    `SELECT setval('homes_id_seq', (SELECT COALESCE(MAX(id), 1) FROM homes))`,
    `ALTER TABLE homes ALTER COLUMN id SET DEFAULT nextval('homes_id_seq')`,
    `CREATE TABLE IF NOT EXISTS home_members (home_id INTEGER NOT NULL REFERENCES homes (id) ON DELETE CASCADE, email TEXT NOT NULL, invited_by TEXT NOT NULL, display_name TEXT, display_key TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (home_id, email))`,
    `CREATE INDEX IF NOT EXISTS home_members_email_idx ON home_members (email)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS home_members_display_key_idx ON home_members (home_id, display_key)`,
    `INSERT INTO home_members (home_id, email, invited_by, created_at) SELECT 1, email, invited_by, created_at FROM residents ON CONFLICT DO NOTHING`,
    `CREATE TABLE IF NOT EXISTS home_revocations (home_id INTEGER NOT NULL REFERENCES homes (id) ON DELETE CASCADE, email TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (home_id, email))`,
    `INSERT INTO home_revocations (home_id, email, created_at) SELECT 1, email, created_at FROM resident_revocations ON CONFLICT DO NOTHING`,
    `ALTER TABLE visits ADD COLUMN IF NOT EXISTS home_id INTEGER NOT NULL DEFAULT 1 REFERENCES homes (id) ON DELETE CASCADE`,
    `CREATE INDEX IF NOT EXISTS visits_home_created_at_idx ON visits (home_id, created_at DESC)`,
    // A device is one browser subscription; each home it rings for has its own name for it.
    `CREATE TABLE IF NOT EXISTS device_homes (device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE, home_id INTEGER NOT NULL REFERENCES homes (id) ON DELETE CASCADE, name TEXT NOT NULL, name_key TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (device_id, home_id))`,
    `CREATE UNIQUE INDEX IF NOT EXISTS device_homes_name_key_idx ON device_homes (home_id, name_key)`,
    `CREATE INDEX IF NOT EXISTS device_homes_home_idx ON device_homes (home_id)`,
    assignDevicesToOriginalHome,
  ],
];
async function runStep(database: Database, step: MigrationStep) {
  if (typeof step === 'string') await database.query(step);
  else if (typeof step === 'function') await step(database);
  else await database.query(step[0], step[1]());
}

const MIGRATION_LOCK = 72_840_311;
const UNDEFINED_TABLE = '42P01';

async function schemaVersion(database: Database): Promise<number> {
  try {
    const result = await database.query<{ version: number | null }>('SELECT MAX(version) AS version FROM schema_migrations');
    return result.rows[0]?.version ?? 0;
  } catch (error) {
    if ((error as { code?: string }).code === UNDEFINED_TABLE) return 0;
    throw error;
  }
}

/**
 * An up-to-date schema costs one query per cold start. Pending versions run in one transaction
 * behind an advisory lock, so concurrent cold starts apply each version exactly once.
 */
export async function initialize(database: Database) {
  if (await schemaVersion(database) >= MIGRATIONS.length) return;
  await database.transaction(async (transaction) => {
    await transaction.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    await transaction.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const current = await schemaVersion(transaction);
    for (let index = current; index < MIGRATIONS.length; index += 1) {
      for (const step of MIGRATIONS[index]) await runStep(transaction, step);
      await transaction.query('INSERT INTO schema_migrations (version) VALUES ($1)', [index + 1]);
    }
  });
}

const databaseGlobal = globalThis as unknown as { ringggDatabase?: Promise<Database> };
export function getDatabase(): Promise<Database> {
  databaseGlobal.ringggDatabase ??= connect().then(async (database) => {
    try { await initialize(database); return database; }
    catch (error) { await database.close?.(); throw error; }
  }).catch((error: unknown) => {
    // A temporary Neon wake-up or network failure must not poison this server instance forever.
    databaseGlobal.ringggDatabase = undefined;
    throw error;
  });
  return databaseGlobal.ringggDatabase;
}
