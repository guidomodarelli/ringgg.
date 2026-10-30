import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import nock from 'nock';
import { ZodError } from 'zod';
import { initialize } from '../src/server/database';
import { addResident, renameResident, resolveHomeAccess } from '../src/server/residents';
import { createHome } from '../src/server/homes';
import { snapshot } from '../src/server/doorbell';
import { findOwnDevice, recordPushReceipt, removeDevice, renameDevice, renewSubscription, saveDevice, sendPush } from '../src/server/push';
import { DEVICES } from '../src/constants/devices';
import { HOMES } from '../src/constants/homes';
import { PUSH_POLICIES } from '../src/constants/push';
import { testDatabase } from './support/test-database';
import { PUSH_SERVICE, pushSubscription, withProvider } from './support/push-subscription';

const postgres = new PGlite();
const database = testDatabase(postgres);
const HOME = HOMES.originalId;
const owner = { id: 'owner-identity', email: 'owner@example.com', name: 'Guido', emailVerified: true };
const member = { id: 'member-identity', email: 'member@example.com', emailVerified: true };
const settings = { bootstrapEmails: [owner.email] };

const deviceNames = async (homeId: number) => (await snapshot(database, homeId)).devices.map((device) => device.name);
const endpoints = async () => (await database.query<{ endpoint: string }>('SELECT endpoint FROM devices ORDER BY endpoint')).rows.map((row) => row.endpoint);
const secondHome = async () => (await createHome(database, owner, 'Casa de mamá', settings)).id;

beforeAll(async () => { await initialize(database); });
beforeEach(async () => {
  for (const table of ['home_members', 'home_revocations', 'devices', 'visits']) await database.query(`DELETE FROM ${table}`);
  await database.query('DELETE FROM homes WHERE id <> $1', [HOME]);
});
afterAll(async () => { await postgres.close(); });

describe('celulares de una casa', () => {
  test('cada celular muestra su nombre y de quién es, como lo llama esa casa', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    await renameResident(database, owner, { homeId: HOME, email: owner.email, name: 'Guido' }, settings);
    await saveDevice(database, { homeId: HOME, name: 'iPhone de Guido', subscription: pushSubscription('owner-device') }, owner, settings);
    await saveDevice(database, { homeId: HOME, name: 'Android', subscription: pushSubscription('member-device') }, member, settings);
    const devices = (await snapshot(database, HOME)).devices.map(({ name, owner: deviceOwner }) => ({ name, owner: deviceOwner }));
    expect(devices).toEqual([{ name: 'iPhone de Guido', owner: 'Guido' }, { name: 'Android', owner: 'member' }]);
  });

  test('al conectarlo, el nombre tiene que ser propio de la casa, y no se puede renombrar a uno ocupado', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    await saveDevice(database, { homeId: HOME, name: 'iPhone', subscription: pushSubscription('first-iphone') }, owner, settings);
    for (const name of ['iphone', ' ÍPHONE ']) {
      await expect(saveDevice(database, { homeId: HOME, name, subscription: pushSubscription('second-iphone') }, member, settings)).rejects.toMatchObject({ code: 'DEVICE_NAME_TAKEN' });
    }
    await saveDevice(database, { homeId: HOME, name: 'iPhone de Cami', subscription: pushSubscription('second-iphone') }, member, settings);
    expect(await deviceNames(HOME)).toEqual(['iPhone', 'iPhone de Cami']);
    const [, second] = (await snapshot(database, HOME)).devices;
    for (const name of ['IPHONE', ' íPhone ']) await expect(renameDevice(database, HOME, second.id, name)).rejects.toMatchObject({ code: 'DEVICE_NAME_TAKEN' });
    await expect(renameDevice(database, HOME, second.id, '   ')).rejects.toThrow(ZodError);
    await renameDevice(database, HOME, second.id, 'Android de Cami');
    expect(await deviceNames(HOME)).toEqual(['iPhone', 'Android de Cami']);
    await expect(renameDevice(database, HOME, crypto.randomUUID(), 'Otro')).rejects.toMatchObject({ code: 'DEVICE_NOT_FOUND' });
  });

  test('si el navegador pasa a otra persona, deja de sonar en las casas de la anterior', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    const other = await secondHome();
    const subscription = pushSubscription('shared-browser');
    await saveDevice(database, { homeId: HOME, name: 'Compu', subscription }, owner, settings);
    await saveDevice(database, { homeId: other, name: 'Compu', subscription }, owner, settings);
    await saveDevice(database, { homeId: HOME, name: 'Compu de Cami', subscription }, member, settings);
    expect(await deviceNames(other)).toEqual([]);
    expect((await snapshot(database, HOME)).devices.map(({ name, owner: deviceOwner }) => ({ name, owner: deviceOwner }))).toEqual([{ name: 'Compu de Cami', owner: 'member' }]);
  });

  test('la confirmación del service worker marca el celular y cuenta un recibo por visita', async () => {
    const subscription = pushSubscription('receipt');
    await saveDevice(database, { homeId: HOME, name: 'Celu de la cocina', subscription }, owner, settings);
    const visitId = crypto.randomUUID();
    await database.query(`INSERT INTO visits (id, message) VALUES ($1, '')`, [visitId]);
    await expect(recordPushReceipt(database, subscription.endpoint, visitId)).resolves.toEqual({ recorded: true });
    await expect(recordPushReceipt(database, subscription.endpoint, visitId)).resolves.toEqual({ recorded: true });
    await expect(recordPushReceipt(database, `${PUSH_SERVICE}/unknown`, visitId)).resolves.toEqual({ recorded: false });
    const state = await snapshot(database, HOME);
    expect(state.visits[0].receipts).toBe(1);
    expect(state.devices[0].last_received_at).not.toBeNull();
    await expect(recordPushReceipt(database, subscription.endpoint, null)).resolves.toEqual({ recorded: true });
  });
});

describe('nombres genéricos', () => {
  test('ningún celular se conecta ni se renombra como «Mi celular» o «Celular»', async () => {
    for (const name of ['Mi celular', 'celular', ' MI CELULAR 2 ', 'Celular 3']) {
      await expect(saveDevice(database, { homeId: HOME, name, subscription: pushSubscription('generic') }, owner, settings)).rejects.toMatchObject({ code: 'DEVICE_NAME_GENERIC' });
    }
    expect(await endpoints()).toEqual([]);
    const { deviceId } = await saveDevice(database, { homeId: HOME, name: 'iPhone de Guido', subscription: pushSubscription('generic') }, owner, settings);
    await expect(renameDevice(database, HOME, deviceId, 'Mi celular')).rejects.toMatchObject({ code: 'DEVICE_NAME_GENERIC' });
    // A name that only starts like a generic one tells the device apart.
    await renameDevice(database, HOME, deviceId, 'Celular de la cocina');
    expect(await deviceNames(HOME)).toEqual(['Celular de la cocina']);
  });
});

describe('un celular en varias casas', () => {
  test('suena en dos casas con un nombre propio en cada una', async () => {
    const other = await secondHome();
    const subscription = pushSubscription('two-homes');
    const first = await saveDevice(database, { homeId: HOME, name: 'iPhone de Guido', subscription }, owner, settings);
    const second = await saveDevice(database, { homeId: other, name: 'iPhone de Guido', subscription }, owner, settings);
    expect(second.deviceId).toBe(first.deviceId);
    await renameDevice(database, other, first.deviceId, 'Celu en lo de mamá');
    expect(await deviceNames(HOME)).toEqual(['iPhone de Guido']);
    expect(await deviceNames(other)).toEqual(['Celu en lo de mamá']);
    // Activating it again keeps the name it has in that home.
    await saveDevice(database, { homeId: other, name: 'iPhone de Guido', subscription }, owner, settings);
    expect(await deviceNames(other)).toEqual(['Celu en lo de mamá']);
    await expect(findOwnDevice(database, subscription.endpoint, await resolveHomeAccess(database, owner, other, settings))).resolves.toEqual({ active: true, deviceId: first.deviceId });
  });

  test('desconectarlo de una casa lo deja sonando en la otra, y sin casas se olvida', async () => {
    const other = await secondHome();
    const subscription = pushSubscription('disconnect');
    const { deviceId } = await saveDevice(database, { homeId: HOME, name: 'Celu de Guido', subscription }, owner, settings);
    await saveDevice(database, { homeId: other, name: 'Celu de Guido', subscription }, owner, settings);
    await removeDevice(database, other, deviceId);
    expect(await deviceNames(other)).toEqual([]);
    expect(await deviceNames(HOME)).toEqual(['Celu de Guido']);
    await removeDevice(database, HOME, deviceId);
    expect(await endpoints()).toEqual([]);
  });

  test('una casa no puede renombrar ni desconectar los celulares de otra', async () => {
    const other = await secondHome();
    const { deviceId } = await saveDevice(database, { homeId: HOME, name: 'Celu de Guido', subscription: pushSubscription('home-only') }, owner, settings);
    await expect(renameDevice(database, other, deviceId, 'Ajeno')).rejects.toMatchObject({ code: 'DEVICE_NOT_FOUND' });
    await removeDevice(database, other, deviceId);
    expect(await deviceNames(HOME)).toEqual(['Celu de Guido']);
  });

  test(`cada casa tiene su propio límite de ${DEVICES.max} celulares`, async () => {
    const other = await secondHome();
    for (let index = 0; index < DEVICES.max; index += 1) await saveDevice(database, { homeId: HOME, name: `Teléfono ${index}`, subscription: pushSubscription(`limit-${index}`) }, owner, settings);
    await expect(saveDevice(database, { homeId: HOME, name: 'Uno más', subscription: pushSubscription('one-more') }, owner, settings)).rejects.toMatchObject({ code: 'DEVICE_LIMIT' });
    await expect(saveDevice(database, { homeId: other, name: 'Teléfono 0', subscription: pushSubscription('limit-0') }, owner, settings)).resolves.toHaveProperty('deviceId');
  });
});

describe('renovación de la suscripción', () => {
  test('conserva las casas y los nombres del celular', async () => {
    const other = await secondHome();
    const original = pushSubscription('original');
    await saveDevice(database, { homeId: HOME, name: 'Celular de la cocina', subscription: original }, owner, settings);
    await saveDevice(database, { homeId: other, name: 'Celu de visita', subscription: original }, owner, settings);
    const renewed = pushSubscription('renewed');
    await expect(renewSubscription(database, owner, renewed, original.endpoint)).resolves.toEqual({ renewed: true });
    expect(await endpoints()).toEqual([renewed.endpoint]);
    expect(await deviceNames(HOME)).toEqual(['Celular de la cocina']);
    expect(await deviceNames(other)).toEqual(['Celu de visita']);
  });

  test('si la suscripción nueva ya estaba registrada, hereda las casas que le faltaban con sus nombres', async () => {
    const other = await secondHome();
    const original = pushSubscription('first');
    const renewed = pushSubscription('second');
    await saveDevice(database, { homeId: HOME, name: 'Celular viejo', subscription: original }, owner, settings);
    await saveDevice(database, { homeId: other, name: 'Celular viejo', subscription: original }, owner, settings);
    await saveDevice(database, { homeId: HOME, name: 'Celular nuevo', subscription: renewed }, owner, settings);
    await expect(renewSubscription(database, owner, renewed, original.endpoint)).resolves.toEqual({ renewed: true });
    expect(await endpoints()).toEqual([renewed.endpoint]);
    expect(await deviceNames(HOME)).toEqual(['Celular nuevo']);
    expect(await deviceNames(other)).toEqual(['Celular viejo']);
  });

  test('si la suscripción nueva es del celular de otra persona, ese celular no recibe las casas y el propio las conserva', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    const other = await secondHome();
    const original = pushSubscription('owner-phone');
    const memberSubscription = pushSubscription('member-phone');
    const { deviceId: ownerPhone } = await saveDevice(database, { homeId: HOME, name: 'Celular de Guido', subscription: original }, owner, settings);
    await saveDevice(database, { homeId: other, name: 'Celu en lo de mamá', subscription: original }, owner, settings);
    const { deviceId: memberPhone } = await saveDevice(database, { homeId: HOME, name: 'Android de Cami', subscription: memberSubscription }, member, settings);
    await expect(renewSubscription(database, owner, memberSubscription, original.endpoint)).resolves.toEqual({ renewed: false });
    const homeDevices = async (homeId: number) => (await snapshot(database, homeId)).devices.map(({ id, name }) => ({ id, name }));
    expect(await homeDevices(other)).toEqual([{ id: ownerPhone, name: 'Celu en lo de mamá' }]);
    expect(await homeDevices(HOME)).toEqual([{ id: ownerPhone, name: 'Celular de Guido' }, { id: memberPhone, name: 'Android de Cami' }]);
  });

  test('nadie puede renovar la suscripción de otra persona', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    const original = pushSubscription('owner-only');
    await saveDevice(database, { homeId: HOME, name: 'Celu de Guido', subscription: original }, owner, settings);
    await expect(renewSubscription(database, member, pushSubscription('hijack'), original.endpoint)).resolves.toEqual({ renewed: false });
    expect(await endpoints()).toEqual([original.endpoint]);
  });
});

describe('avisos', () => {
  test('un timbrazo suena solo en los celulares de su casa', async () => {
    const other = await secondHome();
    await saveDevice(database, { homeId: HOME, name: 'Celu de la casa', subscription: pushSubscription('home-device') }, owner, settings);
    await saveDevice(database, { homeId: other, name: 'Celu de la otra casa', subscription: pushSubscription('other-device') }, owner, settings);
    await withProvider(async () => {
      const homeDevice = nock(PUSH_SERVICE).post('/home-device').reply(201);
      await expect(sendPush(database, { kind: 'ring', homeId: HOME, title: 'Timbre', body: 'Hola' })).resolves.toEqual({ delivery: 'sent', accepted: 1, total: 1 });
      expect(homeDevice.isDone()).toBe(true);
    });
  });

  test('cada envío guarda la salud del celular y borra las suscripciones vencidas', async () => {
    await saveDevice(database, { homeId: HOME, name: 'Acepta', subscription: pushSubscription('accepted') }, owner, settings);
    await saveDevice(database, { homeId: HOME, name: 'Falla', subscription: pushSubscription('failing') }, owner, settings);
    await saveDevice(database, { homeId: HOME, name: 'Vencido', subscription: pushSubscription('gone') }, owner, settings);
    const result = await withProvider(async () => {
      nock(PUSH_SERVICE).post('/accepted').reply(201).post('/failing').reply(500).post('/gone').reply(410);
      return sendPush(database, { kind: 'test', homeId: HOME, title: 'Prueba', body: 'Prueba', residentEmail: owner.email });
    });
    expect(result).toEqual({ delivery: 'partial', accepted: 1, total: 3 });
    const devices = Object.fromEntries((await snapshot(database, HOME)).devices.map((device) => [device.name, device]));
    expect(Object.keys(devices).sort()).toEqual(['Acepta', 'Falla']);
    expect(devices.Acepta.last_success_at).not.toBeNull();
    expect(devices.Falla).toMatchObject({ last_success_at: null, last_failure_status: 500 });
    expect(devices.Falla.last_failure_at).not.toBeNull();
  });

  test('una nota viaja con más tiempo de vida y menos urgencia que un timbrazo', async () => {
    await saveDevice(database, { homeId: HOME, name: 'Celu de Guido', subscription: pushSubscription('policy') }, owner, settings);
    const visitId = crypto.randomUUID();
    await withProvider(async () => {
      const ringPush = nock(PUSH_SERVICE).matchHeader('ttl', String(PUSH_POLICIES.ring.ttlSeconds)).matchHeader('urgency', 'high').post('/policy').reply(201);
      await sendPush(database, { kind: 'ring', homeId: HOME, title: 'Timbre', body: 'Hola', visitId, answerable: true });
      const notePush = nock(PUSH_SERVICE).matchHeader('ttl', String(PUSH_POLICIES.note.ttlSeconds)).matchHeader('urgency', 'normal').post('/policy').reply(201);
      await sendPush(database, { kind: 'note', homeId: HOME, title: 'Mensaje', body: 'Hola', visitId });
      expect(ringPush.isDone() && notePush.isDone()).toBe(true);
    });
  });

  test('la prueba se envía solo a los celulares de esa casa de la persona que la pidió', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    const other = await secondHome();
    await saveDevice(database, { homeId: HOME, name: 'Celular propio', subscription: pushSubscription('owner-device') }, owner, settings);
    await saveDevice(database, { homeId: HOME, name: 'Celular de otra persona', subscription: pushSubscription('other-person') }, member, settings);
    await saveDevice(database, { homeId: other, name: 'Celular de la otra casa', subscription: pushSubscription('other-home') }, owner, settings);
    await withProvider(async () => {
      const ownDevice = nock(PUSH_SERVICE).post('/owner-device').reply(201);
      await expect(sendPush(database, { kind: 'test', homeId: HOME, title: 'Prueba', body: 'Prueba', residentEmail: owner.email })).resolves.toEqual({ delivery: 'sent', accepted: 1, total: 1 });
      expect(ownDevice.isDone()).toBe(true);
    });
  });

  test('la prueba sin celulares propios no envía avisos a otra persona', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    await saveDevice(database, { homeId: HOME, name: 'Celular de otra persona', subscription: pushSubscription('other-person') }, member, settings);
    await expect(sendPush(database, { kind: 'test', homeId: HOME, title: 'Prueba', body: 'Prueba', residentEmail: owner.email })).resolves.toEqual({ delivery: 'unavailable', accepted: 0, total: 0 });
    await expect(sendPush(database, { kind: 'test', homeId: HOME, title: 'Prueba', body: 'Prueba', residentEmail: '' })).resolves.toEqual({ delivery: 'unavailable', accepted: 0, total: 0 });
  });
});
