import type { PoolConfig } from 'pg';
import { DATABASE } from '../constants/database';

/** Validates configuration without exposing the URL in diagnostics or allowing non-Postgres schemes. */
export function getPostgresConfig(connectionString: string): PoolConfig {
  let url: URL;
  try { url = new URL(connectionString); }
  catch (error) { throw new Error('Database: DATABASE_URL debe ser una URL PostgreSQL válida.', { cause: error }); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length <= 1) {
    throw new Error('Database: DATABASE_URL debe incluir protocolo PostgreSQL, servidor, usuario y base.');
  }
  if (url.hostname.endsWith(DATABASE.neonSuffix)) {
    // Preserve credentials and channel binding, while avoiding sslmode=require compatibility changes in pg.
    url.searchParams.set('sslmode', DATABASE.verifiedSslMode);
  }
  return {
    connectionString: url.toString(),
    max: DATABASE.poolMax,
    connectionTimeoutMillis: DATABASE.connectionTimeoutMs,
    idleTimeoutMillis: DATABASE.idleTimeoutMs,
    maxLifetimeSeconds: DATABASE.maxLifetimeSeconds,
    application_name: DATABASE.applicationName,
    enableChannelBinding: true,
  };
}
