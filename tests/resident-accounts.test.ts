import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { initialize } from '../src/server/database';
import { addResident } from '../src/server/residents';
import { listResidentRoster, managedAccounts } from '../src/server/resident-accounts';
import { HOMES } from '../src/constants/homes';
import { testDatabase } from './support/test-database';

// Real PostgreSQL with the app schema and, as Neon Auth leaves it in the app database, the `neon_auth` accounts.
const postgres = new PGlite();
const database = testDatabase(postgres);
const HOME = HOMES.originalId;
const owner = { id: 'owner-identity', email: 'owner@example.com', name: 'Guido', emailVerified: true };
const settings = { bootstrapEmails: [owner.email] };

async function createAccount(email: string, emailVerified: boolean) {
  await database.query(`INSERT INTO neon_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, 'Residente', $2, $3, NOW(), NOW())`, [crypto.randomUUID(), email, emailVerified]);
}

beforeAll(async () => {
  await initialize(database);
  await database.query('CREATE SCHEMA neon_auth');
  await database.query(`CREATE TABLE neon_auth."user" (id UUID PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, "emailVerified" BOOLEAN NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL, "updatedAt" TIMESTAMPTZ NOT NULL)`);
});
beforeEach(async () => {
  for (const table of ['home_members', 'home_revocations', 'residents', 'resident_revocations', 'neon_auth."user"']) await database.query(`DELETE FROM ${table}`);
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await postgres.close(); });

describe('estado de la cuenta de cada residente', () => {
  test('dice quién verificó su correo, quién todavía no lo verificó y quién no creó su cuenta', async () => {
    await createAccount(owner.email, true);
    // The provider may keep the email as the person typed it; the invitation is stored in lowercase.
    await createAccount('Pending@Example.com', false);
    await addResident(database, owner, { homeId: HOME, email: 'pending@example.com' }, settings);
    await addResident(database, owner, { homeId: HOME, email: 'new@example.com' }, settings);
    const roster = await listResidentRoster(database, HOME, settings, managedAccounts(database));
    expect(roster.map(({ email, account }) => ({ email, account }))).toEqual([
      { email: 'new@example.com', account: 'missing' },
      { email: owner.email, account: 'verified' },
      { email: 'pending@example.com', account: 'unverified' },
    ]);
  });

  test('el estado cambia en cuanto la persona crea su cuenta y la verifica', async () => {
    await createAccount(owner.email, true);
    await addResident(database, owner, { homeId: HOME, email: 'new@example.com' }, settings);
    const accountOfNew = async () => (await listResidentRoster(database, HOME, settings, managedAccounts(database))).find((resident) => resident.email === 'new@example.com')?.account;
    expect(await accountOfNew()).toBe('missing');
    await createAccount('new@example.com', false);
    expect(await accountOfNew()).toBe('unverified');
    await database.query(`UPDATE neon_auth."user" SET "emailVerified" = TRUE WHERE email = 'new@example.com'`);
    expect(await accountOfNew()).toBe('verified');
  });

  test('sin las cuentas de Neon Auth en la base, la lista carga igual y no muestra estados', async () => {
    const withoutAuth = new PGlite();
    const local = testDatabase(withoutAuth);
    try {
      await initialize(local);
      await addResident(local, owner, { homeId: HOME, email: 'new@example.com' }, settings);
      expect(await listResidentRoster(local, HOME, settings, managedAccounts(local))).toEqual([
        { email: 'new@example.com', name: null, source: 'invitation', canRemove: true, account: null },
        { email: owner.email, name: null, source: 'environment', canRemove: true, account: null },
      ]);
    } finally { await withoutAuth.close(); }
  });

  test('si el proveedor no responde, la lista carga sin estados y el fallo queda registrado con la casa', async () => {
    // The log is the only trace of this fallback, so it is part of the contract; the spy also keeps it out of the test output.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unavailable = async () => { throw new Error('auth provider unavailable'); };
    const roster = await listResidentRoster(database, HOME, settings, unavailable);
    expect(roster).toEqual([{ email: owner.email, name: null, source: 'environment', canRemove: false, account: null }]);
    expect(logged).toHaveBeenCalledOnce();
    expect(JSON.parse(String(logged.mock.calls[0][0]))).toMatchObject({ operation: 'residents.accounts', homeId: HOME, residents: 1 });
  });
});
