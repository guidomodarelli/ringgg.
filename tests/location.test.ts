import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { initialize } from '../src/server/database';
import { getHome, publicHome, registerVisit, snapshot } from '../src/server/doorbell';
import { clearHomeLocation, setHomeLocation, setNearbyOnly } from '../src/server/location';
import { HOMES } from '../src/constants/homes';
import { NEARBY_RINGING } from '../src/constants/location';
import { testDatabase } from './support/test-database';

const postgres = new PGlite();
const database = testDatabase(postgres);
const HOME = HOMES.originalId;
const DOOR = { latitude: -34.6037, longitude: -58.3816 };
const AT_THE_DOOR = { latitude: DOOR.latitude + 0.00045, longitude: DOOR.longitude, accuracy: 15 };
const ACROSS_TOWN = { latitude: DOOR.latitude + 0.01, longitude: DOOR.longitude, accuracy: 15 };

const ring = async (position: typeof AT_THE_DOOR | null, client = 'visitor', id: string = crypto.randomUUID()) =>
  registerVisit(database, (await getHome(database, HOME)).token, { id, message: '', client, position });

beforeAll(async () => { await initialize(database); });
beforeEach(async () => {
  await database.query('DELETE FROM visits');
  await database.query('DELETE FROM rate_limits');
  await database.query('UPDATE homes SET latitude = NULL, longitude = NULL, nearby_only = FALSE, enabled = TRUE, paused_until = NULL, quiet_start = NULL, quiet_end = NULL WHERE id = $1', [HOME]);
});
afterAll(async () => { await postgres.close(); });

describe('ubicación de la puerta', () => {
  test('se guarda desde una lectura precisa y la ven solo los residentes', async () => {
    await expect(setHomeLocation(database, HOME, { ...DOOR, accuracy: 900 })).rejects.toMatchObject({ code: 'LOCATION_IMPRECISE' });
    await setHomeLocation(database, HOME, { ...DOOR, accuracy: 12 });
    expect((await snapshot(database, HOME)).home).toMatchObject({ ...DOOR, nearby_only: false });
    const visitorView = await publicHome(database, (await getHome(database, HOME)).token);
    expect(visitorView.nearbyOnly).toBe(false);
    expect(visitorView).not.toHaveProperty('latitude');
  });

  test('la puerta exige una lectura más precisa que la de una visita, porque su error no se guarda', async () => {
    const vagueDoor = { latitude: DOOR.latitude + 0.002, longitude: DOOR.longitude, accuracy: 250 };
    await expect(setHomeLocation(database, HOME, vagueDoor)).rejects.toMatchObject({ code: 'LOCATION_IMPRECISE' });
    expect((await snapshot(database, HOME)).home).toMatchObject({ latitude: null, longitude: null });
    await setHomeLocation(database, HOME, { ...DOOR, accuracy: NEARBY_RINGING.doorMaxAccuracyMeters });
    expect((await snapshot(database, HOME)).home).toMatchObject(DOOR);
  });

  test('pedir que toquen desde la puerta necesita la ubicación, y borrarla lo desactiva', async () => {
    await expect(setNearbyOnly(database, HOME, true)).rejects.toMatchObject({ code: 'LOCATION_MISSING' });
    await setHomeLocation(database, HOME, { ...DOOR, accuracy: 12 });
    await setNearbyOnly(database, HOME, true);
    expect((await publicHome(database, (await getHome(database, HOME)).token)).nearbyOnly).toBe(true);
    await clearHomeLocation(database, HOME);
    expect((await snapshot(database, HOME)).home).toMatchObject({ latitude: null, longitude: null, nearby_only: false });
    await setNearbyOnly(database, HOME, false);
  });
});

describe('tocar solo desde la puerta', () => {
  test('sin el requisito se toca desde cualquier lugar y sin ubicación', async () => {
    await expect(ring(null)).resolves.toMatchObject({ created: true });
  });

  test('con el requisito, solo se toca cerca de la puerta y con una lectura precisa', async () => {
    await setHomeLocation(database, HOME, { ...DOOR, accuracy: 12 });
    await setNearbyOnly(database, HOME, true);
    await expect(ring(null)).rejects.toMatchObject({ code: 'LOCATION_REQUIRED' });
    await expect(ring(ACROSS_TOWN)).rejects.toMatchObject({ code: 'TOO_FAR' });
    await expect(ring({ ...AT_THE_DOOR, accuracy: 2000 })).rejects.toMatchObject({ code: 'LOCATION_IMPRECISE' });
    // Rejected rings do not use up the visitor's allowance: the first one from the door goes through.
    const id = crypto.randomUUID();
    await expect(ring(AT_THE_DOOR, 'visitor', id)).resolves.toMatchObject({ created: true });
    // A retry of that ring returns it even if the reading is lost on the way.
    await expect(ring(null, 'visitor', id)).resolves.toMatchObject({ created: false });
    expect((await snapshot(database, HOME)).visits).toHaveLength(1);
  });
});
