import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { initialize, type Database } from '../src/server/database';
import { addResident, listResidents, removeResident, resolveResidentAccess } from '../src/server/residents';
import { hasRegisteredDevice, saveDevice, sendPush } from '../src/server/push';
import { createECDH, randomBytes } from 'node:crypto';
import nock from 'nock';

const postgres = new PGlite();
const database: Database = {
  query: (sql, params) => postgres.query(sql, params),
  transaction: (work) => postgres.transaction((transaction) => work({ query: (sql, params) => transaction.query(sql, params), transaction: async () => { throw new Error('Nested transactions are unsupported'); } })),
};
const admin = { id: 'admin-identity', email: 'owner@example.com', emailVerified: true, isAdmin: true };
const member = { id: 'member-identity', email: 'member@example.com', emailVerified: true, isAdmin: false };
const settings = { adminEmails: admin.email, residentEmails: '' };

beforeAll(async () => { await initialize(database); });
beforeEach(async () => { await database.query('DELETE FROM residents'); await database.query('DELETE FROM resident_revocations'); await database.query('DELETE FROM devices'); });
afterAll(async () => { await postgres.close(); });

describe('residentes persistentes', () => {
  test('el administrador de arranque accede solo después de verificar su correo', async () => {
    await expect(resolveResidentAccess(database, admin, settings)).resolves.toMatchObject({ isAdmin: true });
    await expect(resolveResidentAccess(database, { ...admin, emailVerified: false }, settings)).rejects.toMatchObject({ code: 'EMAIL_UNVERIFIED' });
  });

  test('autorizar es idempotente, normaliza el correo y permite entrar sin reiniciar el servidor', async () => {
    await expect(resolveResidentAccess(database, member, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
    await addResident(database, admin, ' MEMBER@EXAMPLE.COM ', settings);
    await addResident(database, admin, member.email, settings);
    await expect(resolveResidentAccess(database, member, settings)).resolves.toMatchObject({ isAdmin: true });
    const roster = await listResidents(database, admin, settings);
    expect(roster.filter((entry) => entry.email === member.email)).toHaveLength(1);
    expect(roster.find((entry) => entry.email === member.email)?.canRemove).toBe(true);
    await expect(resolveResidentAccess(database, { ...member, emailVerified: false }, settings)).rejects.toMatchObject({ code: 'EMAIL_UNVERIFIED' });
  });

  test('una identidad sin autorización no puede listar, agregar ni quitar residentes', async () => {
    await expect(listResidents(database, member, settings)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    await expect(addResident(database, member, 'other@example.com')).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    await expect(removeResident(database, member, admin.email, settings)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    expect(await listResidents(database, admin, settings)).toEqual([{ email: admin.email, source: 'administrator', canRemove: false }]);
  });

  test('cualquier residente autorizado y verificado puede gestionar a los demás', async () => {
    await addResident(database, admin, member.email, settings);
    const authorizedMember = await resolveResidentAccess(database, member, settings);
    await addResident(database, authorizedMember, 'new@example.com', settings);
    expect((await listResidents(database, authorizedMember, settings)).some((entry) => entry.email === 'new@example.com')).toBe(true);
    await removeResident(database, authorizedMember, 'new@example.com', settings);
    expect((await listResidents(database, authorizedMember, settings)).some((entry) => entry.email === 'new@example.com')).toBe(false);
  });

  test('no se puede quitar al último residente y dejar la vivienda sin acceso', async () => {
    await expect(removeResident(database, admin, admin.email, settings)).rejects.toMatchObject({ code: 'LAST_RESIDENT' });
    await expect(resolveResidentAccess(database, admin, settings)).resolves.toMatchObject({ isAdmin: true });
  });

  test('otro residente puede quitar y volver a autorizar al residente inicial', async () => {
    await addResident(database, admin, member.email, settings);
    const authorizedMember = await resolveResidentAccess(database, member, settings);
    await removeResident(database, authorizedMember, admin.email, settings);
    await expect(resolveResidentAccess(database, admin, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
    await expect(removeResident(database, authorizedMember, member.email, settings)).rejects.toMatchObject({ code: 'LAST_RESIDENT' });
    await addResident(database, authorizedMember, admin.email, settings);
    await expect(resolveResidentAccess(database, admin, settings)).resolves.toMatchObject({ isAdmin: true });
  });

  test('quitar un residente revoca acceso y push, y no permite volver a registrar un dispositivo', async () => {
    await addResident(database, admin, member.email, settings);
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/member-test', keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } };
    await saveDevice(database, 'Teléfono del residente', subscription, member, settings);
    expect((await database.query('SELECT id FROM devices')).rows).toHaveLength(1);
    await expect(hasRegisteredDevice(database, subscription.endpoint, member)).resolves.toBe(true);
    await expect(hasRegisteredDevice(database, subscription.endpoint, admin)).resolves.toBe(false);
    await removeResident(database, admin, member.email, settings);
    await removeResident(database, admin, member.email, settings);
    expect((await database.query('SELECT id FROM devices')).rows).toHaveLength(0);
    await expect(hasRegisteredDevice(database, subscription.endpoint, member)).resolves.toBe(false);
    await expect(resolveResidentAccess(database, member, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
    await expect(saveDevice(database, 'Otro intento', subscription, member, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
  });

  test('una solicitud anterior a la revocación no puede restaurar el acceso ni revocar a otros', async () => {
    await addResident(database, admin, member.email, settings);
    const staleAccess = await resolveResidentAccess(database, member, settings);
    await removeResident(database, admin, member.email, settings);
    await expect(addResident(database, staleAccess, member.email, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
    await expect(removeResident(database, staleAccess, 'other@example.com', settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
    expect((await database.query('SELECT email FROM residents')).rows).toHaveLength(0);
  });

  test('rechaza correos inválidos sin crear invitaciones', async () => {
    await expect(addResident(database, admin, 'esto-no-es-un-correo', settings)).rejects.toThrow();
    expect((await database.query('SELECT email FROM residents')).rows).toHaveLength(0);
  });

  test('la prueba del logo se envía solo a los dispositivos de la persona que la pidió', async () => {
    await addResident(database, admin, member.email, settings);
    const createSubscription = (path: string) => {
      const curve = createECDH('prime256v1'); curve.generateKeys();
      return { endpoint: `https://fcm.googleapis.com/${path}`, keys: { p256dh: curve.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
    };
    await saveDevice(database, 'Celular propio', createSubscription('owner-device'), admin, settings);
    await saveDevice(database, 'Celular de otra persona', createSubscription('other-device'), member, settings);
    nock.disableNetConnect();
    const ownerEndpoint = nock('https://fcm.googleapis.com').post('/owner-device').reply(201);
    try {
      const result = await sendPush(database, { title: 'Prueba', body: 'Prueba', residentEmail: admin.email });
      expect(result).toEqual({ delivery: 'sent', accepted: 1, total: 1 });
      expect(ownerEndpoint.isDone()).toBe(true);
    } finally { nock.cleanAll(); nock.enableNetConnect(); }
  });

  test('la prueba sin dispositivos propios no envía avisos a otra persona', async () => {
    await addResident(database, admin, member.email, settings);
    const curve = createECDH('prime256v1'); curve.generateKeys();
    await saveDevice(database, 'Celular de otra persona', { endpoint: 'https://fcm.googleapis.com/other-device', keys: { p256dh: curve.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }, member, settings);
    await expect(sendPush(database, { title: 'Prueba', body: 'Prueba', residentEmail: admin.email })).resolves.toEqual({ delivery: 'unavailable', accepted: 0, total: 0 });
    await expect(sendPush(database, { title: 'Prueba', body: 'Prueba', residentEmail: '' })).resolves.toEqual({ delivery: 'unavailable', accepted: 0, total: 0 });
  });
});
