import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import nock from 'nock';
import { initialize, type Database, type QueryResult } from '../src/server/database';
import { followVisit, getHome, leaveNoteAndNotify, purgeExpiredData, registerVisit, ringAndNotify, setPause, snapshot } from '../src/server/doorbell';
import { setHomeLocation, setNearbyOnly } from '../src/server/location';
import { saveDevice } from '../src/server/push';
import { addResident, removeResident, renameResident } from '../src/server/residents';
import { createHome } from '../src/server/homes';
import { DOORBELL, HTTP, RING_LIMITS } from '../src/constants/doorbell';
import { HOMES } from '../src/constants/homes';
import { PUSH } from '../src/constants/push';
import { TIME } from '../src/constants/time';
import { testDatabase } from './support/test-database';
import { PUSH_SERVICE, pushSubscription, withProvider } from './support/push-subscription';

const postgres = new PGlite();
const database = testDatabase(postgres);
const HOME = HOMES.originalId;
const owner = { id: 'owner-identity', email: 'owner@example.com', name: 'Guido', emailVerified: true };
const ana = { id: 'ana-identity', email: 'ana@example.com', name: 'Ana', emailVerified: true };
const settings = { bootstrapEmails: [owner.email] };
const DOOR = { latitude: -34.6037, longitude: -58.3816 };
const ACROSS_TOWN = { latitude: DOOR.latitude + 0.01, longitude: DOOR.longitude, accuracy: 15 };
const AT_THE_DOOR = { latitude: DOOR.latitude + 0.0002, longitude: DOOR.longitude, accuracy: 15 };
const VISITOR = 'visitor-client-hash';
const MESSAGE = 'Soy Juan, traigo el paquete';
const CONNECTION_LOST = 'Connection terminated unexpectedly';
/** Generous ceiling for the work a test ring does on PGlite, so a stored time is the request's and not a stray clock. */
const RING_WORK_CEILING_MS = 5_000;

/** Today in the home's time zone, as PostgreSQL prints a `date`. */
const homeToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: DOORBELL.timeZone }).format(new Date());
const ringOf = (position: typeof AT_THE_DOOR | null = null, client = VISITOR) => ({ id: crypto.randomUUID(), message: MESSAGE, client, position });
const rejectionRows = async () => (await database.query<{ home_id: number; day: string; code: string; count: number }>('SELECT home_id, day::text AS day, code, count FROM ring_rejections ORDER BY code')).rows;
const ringTime = async (id: string) => (await database.query<{ ring_ms: number | null }>('SELECT ring_ms FROM visits WHERE id = $1', [id])).rows[0].ring_ms;
const deliveries = async (visitId: string) => (await database.query<{ device_id: string; kind: string; outcome: string; status: number | null }>('SELECT device_id, kind, outcome, status FROM visit_deliveries WHERE visit_id = $1 ORDER BY status', [visitId])).rows;
/** What a ring's failure tells the visitor: the same fields `errorResponse` sends. */
const answerOf = (error: unknown) => { const { status, code, message } = error as { status: number; code: string; message: string }; return { status, code, message }; };
const failureOf = async (attempt: Promise<unknown>) => attempt.then(() => { throw new Error('The ring was expected to fail'); }, answerOf);

/** The app's database port over the same PGlite, where only the statements outside a transaction fail, as with a connection that breaks after the ring's transaction. */
function failingOutsideTransactions(): Database {
  return {
    query: async <Row>(): Promise<QueryResult<Row>> => { throw new Error(CONNECTION_LOST); },
    transaction: (work) => database.transaction(work),
  };
}

beforeAll(async () => { await initialize(database); });
afterAll(async () => { await postgres.close(); });
beforeEach(async () => {
  for (const table of ['devices', 'visits', 'rate_limits', 'ring_rejections', 'device_removals', 'home_members', 'home_revocations']) await database.query(`DELETE FROM ${table}`);
  await database.query('DELETE FROM homes WHERE id <> $1', [HOME]);
  await database.query('UPDATE homes SET latitude = NULL, longitude = NULL, nearby_only = FALSE, enabled = TRUE, paused_until = NULL, quiet_start = NULL, quiet_end = NULL WHERE id = $1', [HOME]);
});

describe('timbrazos rechazados', () => {
  test('un rechazo por ubicación, por cooldown o por pausa suma al contador del día, sin datos de la visita y con la misma respuesta', async () => {
    const { token } = await getHome(database, HOME);
    await setHomeLocation(database, HOME, { ...DOOR, accuracy: 12 });
    await setNearbyOnly(database, HOME, true);
    // The answer without counting (registering alone) is the one the visitor still gets.
    const tooFar = await failureOf(registerVisit(database, token, ringOf(ACROSS_TOWN)));
    expect(tooFar).toMatchObject({ status: HTTP.conflict, code: 'TOO_FAR' });
    await expect(failureOf(ringAndNotify(database, token, ringOf(ACROSS_TOWN)))).resolves.toEqual(tooFar);
    await expect(failureOf(ringAndNotify(database, token, ringOf({ ...AT_THE_DOOR, accuracy: 2_000 })))).resolves.toMatchObject({ code: 'LOCATION_IMPRECISE' });
    await expect(ringAndNotify(database, token, ringOf(AT_THE_DOOR))).resolves.toMatchObject({ delivery: 'unavailable' });
    const cooldown = await failureOf(ringAndNotify(database, token, ringOf(AT_THE_DOOR)));
    expect(cooldown).toEqual({ status: HTTP.tooMany, code: 'COOLDOWN', message: `Ya tocaste el timbre hace poco. Esperá ${RING_LIMITS.clientCooldownSeconds} segundos.` });
    await setPause(database, HOME, 'indefinite');
    await expect(failureOf(ringAndNotify(database, token, ringOf(AT_THE_DOOR, 'another-visitor')))).resolves.toMatchObject({ status: HTTP.conflict, code: 'PAUSED' });

    const day = homeToday();
    const rows = await rejectionRows();
    expect(rows).toEqual(['COOLDOWN', 'LOCATION_IMPRECISE', 'PAUSED', 'TOO_FAR'].map((code) => ({ home_id: HOME, day, code, count: 1 })));
    // Only the home, the day, the reason and how many: nothing about who rang, from where or what they wrote.
    const stored = JSON.stringify((await database.query('SELECT * FROM ring_rejections')).rows);
    for (const visitorData of [MESSAGE, VISITOR, String(ACROSS_TOWN.latitude), String(AT_THE_DOOR.latitude)]) expect(stored).not.toContain(visitorData);
    expect((await snapshot(database, HOME)).visits).toHaveLength(1);
  });

  test('si no se puede contar el rechazo, se registra el fallo y la visita recibe la misma respuesta', async () => {
    const { token } = await getHome(database, HOME);
    await setPause(database, HOME, 'indefinite');
    const expected = await failureOf(registerVisit(database, token, ringOf()));
    await expect(failureOf(ringAndNotify(failingOutsideTransactions(), token, ringOf()))).resolves.toEqual(expected);
    expect(await rejectionRows()).toEqual([]);
  });

  test('el panel muestra solo los rechazos de hoy en la hora de la casa, el motivo más frecuente primero', async () => {
    const { token } = await getHome(database, HOME);
    await database.query(`INSERT INTO ring_rejections (home_id, day, code, count) VALUES ($1, (NOW() AT TIME ZONE $2)::date - 1, 'TOO_FAR', 7)`, [HOME, DOORBELL.timeZone]);
    await setHomeLocation(database, HOME, { ...DOOR, accuracy: 12 });
    await setNearbyOnly(database, HOME, true);
    await failureOf(ringAndNotify(database, token, ringOf({ ...AT_THE_DOOR, accuracy: 2_000 })));
    for (const client of ['first', 'second']) await failureOf(ringAndNotify(database, token, ringOf(ACROSS_TOWN, client)));
    expect((await snapshot(database, HOME)).rejectedRings).toEqual([{ code: 'TOO_FAR', count: 2 }, { code: 'LOCATION_IMPRECISE', count: 1 }]);
  });

  test('un QR inválido, un ID ajeno o un reintento de un timbrazo ya registrado no cuentan como rechazos', async () => {
    const { token } = await getHome(database, HOME);
    const ring = ringOf();
    await ringAndNotify(database, token, ring);
    await expect(failureOf(ringAndNotify(database, 'otro-token', ringOf()))).resolves.toMatchObject({ code: 'INVALID_DOORBELL' });
    await setPause(database, HOME, 'indefinite');
    await expect(ringAndNotify(database, token, ring)).resolves.toMatchObject({ id: ring.id });
    expect(await rejectionRows()).toEqual([]);
  });
});

describe('duración del timbrazo', () => {
  test('se guarda con la entrega, contada desde que llegó el pedido', async () => {
    const { token } = await getHome(database, HOME);
    await saveDevice(database, { homeId: HOME, name: 'Celu de la cocina', subscription: pushSubscription('kitchen') }, owner, settings);
    const waited = 1_500;
    const ring = ringOf();
    await withProvider(async () => {
      nock(PUSH_SERVICE).post('/kitchen').reply(201);
      await expect(ringAndNotify(database, token, ring, performance.now() - waited)).resolves.toMatchObject({ delivery: 'sent' });
    });
    const stored = await ringTime(ring.id);
    expect(stored).toBeGreaterThanOrEqual(waited);
    expect(stored).toBeLessThan(waited + RING_WORK_CEILING_MS);
    // Without phones there is no send, and the delivery stored still says how long the ring took.
    await database.query('DELETE FROM devices');
    const unannounced = ringOf(null, 'another-visitor');
    await expect(ringAndNotify(database, token, unannounced)).resolves.toMatchObject({ delivery: 'unavailable' });
    expect(await ringTime(unannounced.id)).toBeGreaterThanOrEqual(0);
  });

  test('si lo avisa el seguimiento de la visita, cuenta lo que esperó desde que se registró', async () => {
    const { token } = await getHome(database, HOME);
    const ring = ringOf();
    const waitedSeconds = 30;
    await registerVisit(database, token, ring);
    expect(await ringTime(ring.id)).toBeNull();
    await database.query(`UPDATE visits SET created_at = created_at - $2 * INTERVAL '1 second' WHERE id = $1`, [ring.id, waitedSeconds]);
    await database.query(`UPDATE rate_limits SET expires_at = expires_at - $1 * INTERVAL '1 second'`, [PUSH.claimSeconds]);
    await expect(followVisit(database, token, ring.id)).resolves.toMatchObject({ delivery: 'unavailable' });
    expect(await ringTime(ring.id)).toBeGreaterThanOrEqual(waitedSeconds * TIME.secondMs);
  });
});

describe('resultado de cada envío', () => {
  test('un envío con un 201 y un 410 deja una fila por celular con su status y el rastro del celular dado de baja en cada casa', async () => {
    const { token } = await getHome(database, HOME);
    await addResident(database, owner, { homeId: HOME, email: ana.email }, settings);
    await renameResident(database, owner, { homeId: HOME, email: ana.email, name: 'Ana' }, settings);
    const other = (await createHome(database, ana, 'Casa de mamá', settings)).id;
    const kitchen = await saveDevice(database, { homeId: HOME, name: 'Android de Guido', subscription: pushSubscription('android') }, owner, settings);
    const iphoneSubscription = pushSubscription('iphone');
    const iphone = await saveDevice(database, { homeId: HOME, name: 'iPhone de Ana', subscription: iphoneSubscription }, ana, settings);
    await saveDevice(database, { homeId: other, name: 'Celu de Ana', subscription: iphoneSubscription }, ana, settings);
    const ring = ringOf();
    await withProvider(async () => {
      nock(PUSH_SERVICE).post('/android').reply(201).post('/iphone').reply(410);
      await expect(ringAndNotify(database, token, ring)).resolves.toMatchObject({ delivery: 'partial' });
    });
    expect(await deliveries(ring.id)).toEqual([
      { device_id: kitchen.deviceId, kind: 'ring', outcome: 'accepted', status: 201 },
      { device_id: iphone.deviceId, kind: 'ring', outcome: 'gone', status: 410 },
    ]);
    // The device is gone from every home, as before; each home keeps what it called it and whose it was.
    const state = await snapshot(database, HOME);
    expect(state.devices.map((device) => device.name)).toEqual(['Android de Guido']);
    expect(state.removedDevices).toEqual([{ id: iphone.deviceId, name: 'iPhone de Ana', owner: 'Ana', status: 410, removed_at: expect.any(String) }]);
    expect(Date.now() - new Date(state.removedDevices[0].removed_at).getTime()).toBeLessThan(RING_WORK_CEILING_MS);
    expect((await snapshot(database, other)).removedDevices).toMatchObject([{ id: iphone.deviceId, name: 'Celu de Ana', status: 410 }]);
  });

  test('una falla que no es una baja queda como fallida con su status, y la nota de la visita tiene su propia fila', async () => {
    await saveDevice(database, { homeId: HOME, name: 'Celu de Guido', subscription: pushSubscription('flaky') }, owner, settings);
    const { token } = await getHome(database, HOME);
    const ring = ringOf();
    await withProvider(async () => {
      nock(PUSH_SERVICE).post('/flaky').reply(500).post('/flaky').reply(201);
      await expect(ringAndNotify(database, token, ring)).resolves.toMatchObject({ delivery: 'unavailable' });
      await database.query(`UPDATE visits SET created_at = NOW() - $2 * INTERVAL '1 second' WHERE id = $1`, [ring.id, DOORBELL.responseWindowSeconds + 1]);
      await leaveNoteAndNotify(database, token, ring.id, 'Vuelvo mañana');
    });
    const rows = (await database.query<{ kind: string; outcome: string; status: number }>('SELECT kind, outcome, status FROM visit_deliveries WHERE visit_id = $1 ORDER BY kind', [ring.id])).rows;
    expect(rows).toEqual([{ kind: 'note', outcome: 'accepted', status: 201 }, { kind: 'ring', outcome: 'failed', status: 500 }]);
    expect((await snapshot(database, HOME)).removedDevices).toEqual([]);
  });
});

describe('rastro de los celulares dados de baja', () => {
  /** Ana's phone rings for both homes until the provider answers 410 for it. */
  async function removedPhone() {
    await addResident(database, owner, { homeId: HOME, email: ana.email }, settings);
    const other = (await createHome(database, ana, 'Casa de mamá', settings)).id;
    const subscription = pushSubscription('expired-iphone');
    await saveDevice(database, { homeId: HOME, name: 'iPhone de Ana', subscription }, ana, settings);
    await saveDevice(database, { homeId: other, name: 'iPhone de Ana', subscription }, ana, settings);
    await withProvider(async () => {
      nock(PUSH_SERVICE).post('/expired-iphone').reply(410);
      await ringAndNotify(database, (await getHome(database, HOME)).token, ringOf());
    });
    return other;
  }
  const removedNames = async (homeId: number) => (await snapshot(database, homeId)).removedDevices.map((device) => device.name);

  test('volver a conectar ese celular en esa casa borra el rastro de esa casa y no el de la otra', async () => {
    const other = await removedPhone();
    expect(await removedNames(HOME)).toEqual(['iPhone de Ana']);
    // The phone subscribes again (a new endpoint) and its owner connects it to the home.
    await saveDevice(database, { homeId: HOME, name: 'iPhone de Ana', subscription: pushSubscription('renewed-iphone') }, ana, settings);
    expect(await removedNames(HOME)).toEqual([]);
    expect(await removedNames(other)).toEqual(['iPhone de Ana']);
  });

  test('con otro nombre, lo borra si era el único del dueño en la casa; con dos, solo el del mismo nombre', async () => {
    await removedPhone();
    await saveDevice(database, { homeId: HOME, name: 'iPhone 15 de Ana', subscription: pushSubscription('renamed-iphone') }, ana, settings);
    expect(await removedNames(HOME)).toEqual([]);
    for (const name of ['iPad de Ana', 'Mac de Ana']) {
      await database.query(`INSERT INTO device_removals (home_id, device_id, name, name_key, resident_email, status) VALUES ($1, $2, $3, lower($3), $4, 410)`, [HOME, crypto.randomUUID(), name, ana.email]);
    }
    await saveDevice(database, { homeId: HOME, name: 'Otro celular de Ana', subscription: pushSubscription('another') }, ana, settings);
    expect((await removedNames(HOME)).sort()).toEqual(['Mac de Ana', 'iPad de Ana']);
    await saveDevice(database, { homeId: HOME, name: 'iPad de Ana', subscription: pushSubscription('ipad') }, ana, settings);
    expect(await removedNames(HOME)).toEqual(['Mac de Ana']);
  });

  test('quitar al residente de la casa borra el rastro de sus celulares ahí', async () => {
    const other = await removedPhone();
    await removeResident(database, owner, { homeId: HOME, email: ana.email }, settings);
    expect(await removedNames(HOME)).toEqual([]);
    expect(await removedNames(other)).toEqual(['iPhone de Ana']);
  });
});

describe('retención', () => {
  test('la purga diaria borra lo que tiene más de 30 días y el panel ya no lo muestra', async () => {
    const { retentionDays, timeZone } = DOORBELL;
    const recent = crypto.randomUUID();
    const old = crypto.randomUUID();
    await database.query(`INSERT INTO visits (id, message) VALUES ($1, 'Reciente')`, [recent]);
    await database.query(`INSERT INTO visits (id, message, created_at) VALUES ($1, 'Vieja', NOW() - ($2 + 1) * INTERVAL '1 day')`, [old, retentionDays]);
    for (const visitId of [recent, old]) await database.query(`INSERT INTO visit_deliveries (visit_id, device_id, kind, outcome, status) VALUES ($1, 'device', 'ring', 'accepted', 201)`, [visitId]);
    await database.query(
      `INSERT INTO ring_rejections (home_id, day, code, count) VALUES ($1, (NOW() AT TIME ZONE $2)::date, 'TOO_FAR', 1), ($1, (NOW() AT TIME ZONE $2)::date - ($3 + 1), 'TOO_FAR', 4)`,
      [HOME, timeZone, retentionDays],
    );
    await database.query(
      `INSERT INTO device_removals (home_id, device_id, name, name_key, status, removed_at) VALUES ($1, 'recent-phone', 'Reciente', 'reciente', 410, NOW()), ($1, 'old-phone', 'Viejo', 'viejo', 404, NOW() - ($2 + 1) * INTERVAL '1 day')`,
      [HOME, retentionDays],
    );
    expect((await snapshot(database, HOME)).removedDevices.map((device) => device.name)).toEqual(['Reciente']);
    await expect(purgeExpiredData(database)).resolves.toEqual({ visits: 1, rateLimits: 0, rejectedRings: 1, removedDevices: 1 });
    expect((await database.query('SELECT visit_id FROM visit_deliveries')).rows).toEqual([{ visit_id: recent }]);
    expect(await rejectionRows()).toEqual([{ home_id: HOME, day: homeToday(), code: 'TOO_FAR', count: 1 }]);
    expect((await database.query('SELECT device_id FROM device_removals')).rows).toEqual([{ device_id: 'recent-phone' }]);
  });
});
