import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { initialize, type Database } from '../src/server/database';
import { addResident, listResidents, removeResident, resolveResidentAccess } from '../src/server/residents';
import { saveDevice } from '../src/server/push';

const postgres = new PGlite();
const database: Database = {
  query: (sql, params) => postgres.query(sql, params),
  transaction: (work) => postgres.transaction((transaction) => work({ query: (sql, params) => transaction.query(sql, params), transaction: async () => { throw new Error('Nested transactions are unsupported'); } })),
};
const admin = { id: 'admin-identity', email: 'owner@example.com', emailVerified: true, isAdmin: true };
const member = { id: 'member-identity', email: 'member@example.com', emailVerified: true, isAdmin: false };
const settings = { adminEmails: admin.email, residentEmails: '' };

beforeAll(async () => { await initialize(database); });
beforeEach(async () => { await database.query('DELETE FROM residents'); await database.query('DELETE FROM devices'); });
afterAll(async () => { await postgres.close(); });

describe('residentes persistentes', () => {
  test('el administrador de arranque accede solo después de verificar su correo', async () => {
    await expect(resolveResidentAccess(database, admin, settings)).resolves.toMatchObject({ isAdmin: true });
    await expect(resolveResidentAccess(database, { ...admin, emailVerified: false }, settings)).rejects.toMatchObject({ code: 'EMAIL_UNVERIFIED' });
  });

  test('autorizar es idempotente, normaliza el correo y permite entrar sin reiniciar el servidor', async () => {
    await expect(resolveResidentAccess(database, member, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
    await addResident(database, admin, ' MEMBER@EXAMPLE.COM ');
    await addResident(database, admin, member.email);
    await expect(resolveResidentAccess(database, member, settings)).resolves.toMatchObject({ isAdmin: false });
    const roster = await listResidents(database, admin, settings);
    expect(roster.filter((entry) => entry.email === member.email)).toHaveLength(1);
    expect(roster.find((entry) => entry.email === member.email)?.canRemove).toBe(true);
    await expect(resolveResidentAccess(database, { ...member, emailVerified: false }, settings)).rejects.toMatchObject({ code: 'EMAIL_UNVERIFIED' });
  });

  test('un residente común no puede listar, agregar, quitar correos ni concederse administración', async () => {
    await expect(listResidents(database, member, settings)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    await expect(addResident(database, member, 'other@example.com')).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    await expect(removeResident(database, member, admin.email, settings)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    expect(await listResidents(database, admin, settings)).toEqual([{ email: admin.email, source: 'administrator', canRemove: false }]);
  });

  test('el administrador no puede eliminar el acceso protegido ni perder la vivienda por accidente', async () => {
    await expect(removeResident(database, admin, admin.email, settings)).rejects.toMatchObject({ code: 'RESIDENT_PROTECTED' });
    await expect(resolveResidentAccess(database, admin, settings)).resolves.toMatchObject({ isAdmin: true });
  });

  test('quitar un residente revoca acceso y push, y no permite volver a registrar un dispositivo', async () => {
    await addResident(database, admin, member.email);
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/member-test', keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } };
    await saveDevice(database, 'Teléfono del residente', subscription, member, settings);
    expect((await database.query('SELECT id FROM devices')).rows).toHaveLength(1);
    await removeResident(database, admin, member.email, settings);
    await removeResident(database, admin, member.email, settings);
    expect((await database.query('SELECT id FROM devices')).rows).toHaveLength(0);
    await expect(resolveResidentAccess(database, member, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
    await expect(saveDevice(database, 'Otro intento', subscription, member, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
  });

  test('rechaza correos inválidos sin crear invitaciones', async () => {
    await expect(addResident(database, admin, 'esto-no-es-un-correo')).rejects.toThrow();
    expect((await database.query('SELECT email FROM residents')).rows).toHaveLength(0);
  });
});
