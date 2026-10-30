import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { getPostgresConfig } from '../config/database';
import { logError } from './errors';

/**
 * Logs background disconnects with their cause (driver errors never include the connection string).
 * On Vercel, idle clients are released before Fluid Compute suspends the instance.
 */
export function createPostgresPool(connectionString: string): Pool {
  const pool = new Pool(getPostgresConfig(connectionString));
  pool.on('error', (error) => { logError('database.pool.idleConnection', error, { provider: 'postgres' }); });
  if (process.env.VERCEL) attachDatabasePool(pool);
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
