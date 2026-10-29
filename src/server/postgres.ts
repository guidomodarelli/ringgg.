import { Pool } from 'pg';
import { getPostgresConfig } from '../config/database';

/** Logs background disconnects without leaking provider messages, credentials, or connection strings. */
export function createPostgresPool(connectionString: string): Pool {
  const pool = new Pool(getPostgresConfig(connectionString));
  pool.on('error', () => {
    console.error(JSON.stringify({ operation: 'database.pool.idleConnection', provider: 'postgres', errorType: 'ConnectionError' }));
  });
  return pool;
}

/** Verifies the real protocol and a read-only transaction without initializing or changing app data. */
export async function checkPostgres(pool: Pool): Promise<void> {
  const client = await pool.connect();
  let failed = true;
  try {
    await client.query('BEGIN READ ONLY');
    await client.query('SELECT 1 AS connected');
    await client.query('ROLLBACK');
    failed = false;
  } finally { client.release(failed); }
}
