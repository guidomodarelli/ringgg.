import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '../src/server/database';
import { importVerifiedIdentities } from '../src/server/identity-import';

const postgres = new PGlite();
const database: Database = {
  query: (sql, params) => postgres.query(sql, params),
  transaction: (work) => postgres.transaction((transaction) => work({ query: (sql, params) => transaction.query(sql, params), transaction: async () => { throw new Error('Nested transactions are unsupported'); } })),
};
const residentId = 'a7ce44b0-0042-44e5-b324-ab813024828b';
beforeAll(async () => {
  for (const schema of ['neon_auth', 'ringgg_auth_test']) {
    await database.query(`CREATE SCHEMA ${schema}`);
    await database.query(`CREATE TABLE ${schema}."user" (id UUID PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, "emailVerified" BOOLEAN NOT NULL, image TEXT, "createdAt" TIMESTAMPTZ NOT NULL, "updatedAt" TIMESTAMPTZ NOT NULL, banned BOOLEAN DEFAULT FALSE)`);
    await database.query(`CREATE TABLE ${schema}.account (id UUID PRIMARY KEY, "userId" UUID NOT NULL, password TEXT)`);
  }
  await database.query('CREATE TABLE neon_auth.organization (id TEXT PRIMARY KEY)');
});
beforeEach(async () => {
  for (const table of ['neon_auth.account', 'ringgg_auth_test.account', 'neon_auth."user"', 'ringgg_auth_test."user"', 'neon_auth.organization']) await database.query(`DELETE FROM ${table}`);
  await database.query(`INSERT INTO neon_auth."user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,'Residente','resident@example.com',true,NOW(),NOW())`, [residentId]);
  await database.query(`INSERT INTO neon_auth.account (id,"userId",password) VALUES ('b3b9e67b-e1fd-4fc5-a501-8f96bf5d3f44',$1,'hash-de-prueba')`, [residentId]);
});
afterAll(async () => { await postgres.close(); });

describe('importación de identidades para acceso con Google', () => {
  test('conserva el ID y correo verificado sin copiar contraseñas y admite reintentos', async () => {
    expect(await importVerifiedIdentities(database, 'ringgg_auth_test')).toBe(1);
    expect(await importVerifiedIdentities(database, 'ringgg_auth_test')).toBe(1);
    const users = await database.query<{ id: string; email: string; verified: boolean }>('SELECT id,email,"emailVerified" AS verified FROM ringgg_auth_test."user"');
    expect(users.rows).toEqual([{ id: residentId, email: 'resident@example.com', verified: true }]);
    expect((await database.query('SELECT id FROM ringgg_auth_test.account')).rows).toHaveLength(0);
    expect((await database.query('SELECT id FROM neon_auth.account')).rows).toHaveLength(1);
  });
  test('detiene la copia si existe el mismo correo con otro identificador', async () => {
    await database.query(`INSERT INTO ringgg_auth_test."user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ('c375cb52-92cf-4e8b-a07f-fdb6b8b35d8e','Otra','resident@example.com',true,NOW(),NOW())`);
    await expect(importVerifiedIdentities(database, 'ringgg_auth_test')).rejects.toThrow('identity conflicts');
    expect((await database.query('SELECT id FROM ringgg_auth_test."user"')).rows).toHaveLength(1);
  });
  test('no importa cuentas no verificadas, bloqueadas ni organizaciones que requieren revisión', async () => {
    await database.query('UPDATE neon_auth."user" SET "emailVerified"=false WHERE id=$1', [residentId]);
    await expect(importVerifiedIdentities(database, 'ringgg_auth_test')).rejects.toThrow('individual review');
    await database.query('UPDATE neon_auth."user" SET "emailVerified"=true,banned=true WHERE id=$1', [residentId]);
    await expect(importVerifiedIdentities(database, 'ringgg_auth_test')).rejects.toThrow('individual review');
    await database.query('UPDATE neon_auth."user" SET banned=false WHERE id=$1', [residentId]);
    await database.query("INSERT INTO neon_auth.organization (id) VALUES ('organization-test')");
    await expect(importVerifiedIdentities(database, 'ringgg_auth_test')).rejects.toThrow('individual review');
    expect((await database.query('SELECT id FROM ringgg_auth_test."user"')).rows).toHaveLength(0);
  });
  test('rechaza esquemas reservados y nombres inválidos', async () => {
    await expect(importVerifiedIdentities(database, 'neon_auth')).rejects.toThrow('invalid target schema');
    await expect(importVerifiedIdentities(database, 'public')).rejects.toThrow('invalid target schema');
    await expect(importVerifiedIdentities(database, 'x; DROP SCHEMA neon_auth')).rejects.toThrow('invalid target schema');
  });
});
