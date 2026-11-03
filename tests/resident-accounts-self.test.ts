import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { getMigrations } from 'better-auth/db/migration';
import type { Dialect } from 'kysely';
import { getDatabase } from '../src/server/database';
import { addResident, residentSettings } from '../src/server/residents';
import { listResidentRoster } from '../src/server/resident-accounts';
import { getSelfAuth } from '../src/server/self-auth';
import { HOMES } from '../src/constants/homes';
import { servePglite } from './support/pglite-server';

// Real Better Auth, `pg` driver and PostgreSQL (PGlite behind the wire protocol), with the self-managed provider active.
const OWNER_EMAIL = 'owner@example.com';
const postgres = new PGlite();
let server: { url: string; close: () => Promise<void> } | undefined;

beforeAll(async () => {
  server = await servePglite(postgres);
  vi.stubEnv('AUTH_PROVIDER', 'self');
  vi.stubEnv('APP_URL', 'http://localhost:3000');
  vi.stubEnv('SELF_AUTH_SECRET', 'ringgg-resident-accounts-test-secret-only');
  vi.stubEnv('SELF_AUTH_DATABASE_URL', server.url);
  vi.stubEnv('GOOGLE_CLIENT_ID', 'ringgg-test-client');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'ringgg-test-client-secret');
  vi.stubEnv('DATABASE_URL', server.url);
  vi.stubEnv('RESIDENT_EMAILS', OWNER_EMAIL);
  await (await getMigrations(getSelfAuth().options)).runMigrations();
  const context = await getSelfAuth().$context;
  // The accounts Google sign-in would provision, created directly: the test is about reading them, not OAuth.
  await context.internalAdapter.createUser({ email: OWNER_EMAIL, name: 'Guido', emailVerified: true }, { method: 'admin' });
  await context.internalAdapter.createUser({ email: 'pending@example.com', name: 'Cami', emailVerified: false }, { method: 'admin' });
}, 60_000);
afterAll(async () => {
  // Both pools end their connections first, as on a shutdown, so closing the server drops none in use.
  const { dialect } = getSelfAuth().options.database as { dialect: Dialect };
  const authDriver = dialect.createDriver();
  await authDriver.init();
  await Promise.all([authDriver.destroy(), getDatabase().then((database) => database.close?.())]);
  await server?.close();
  await postgres.close();
  vi.unstubAllEnvs();
});

test('con el login propio, el estado de cada residente sale de las cuentas de Better Auth', async () => {
  const database = await getDatabase();
  const owner = { id: 'owner-identity', email: OWNER_EMAIL, name: 'Guido', emailVerified: true };
  await addResident(database, owner, { homeId: HOMES.originalId, email: 'pending@example.com' });
  await addResident(database, owner, { homeId: HOMES.originalId, email: 'new@example.com' });
  const roster = await listResidentRoster(database, HOMES.originalId, residentSettings());
  expect(roster.map(({ email, account }) => ({ email, account }))).toEqual([
    { email: 'new@example.com', account: 'missing' },
    { email: OWNER_EMAIL, account: 'verified' },
    { email: 'pending@example.com', account: 'unverified' },
  ]);
});
