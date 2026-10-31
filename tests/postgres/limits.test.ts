import { beforeAll, describe, expect, test } from 'vitest';
import { createHome, deleteHome } from '../../src/server/homes';
import { saveDevice } from '../../src/server/push';
import { listResidentHomes } from '../../src/server/residents';
import { HTTP } from '../../src/constants/doorbell';
import { DEVICES } from '../../src/constants/devices';
import { HOMES } from '../../src/constants/homes';
import type { Database } from '../../src/server/database';
import type { ResidentIdentity } from '../../src/types/auth';
import { pushSubscription } from '../support/push-subscription';
import { TEST_POSTGRES_URL, errorAnswers, fulfilledValues, openRun, residentOf, seedHome, spread, type PostgresRun, type Statement } from '../support/postgres-run';

/** Requests at once: every connection of the two instances, three each as in production. */
const CONCURRENT_REQUESTS = 6;
const NO_BOOTSTRAP = { bootstrapEmails: [] };
/** Held from another connection, it stops each request right before it registers the device, after it read the home's. */
const BEFORE_STORING_DEVICES: Statement = ['LOCK TABLE devices IN SHARE MODE'];
/** Held from another connection, it stops each request right before it creates or deletes a home, after it read the person's. */
const BEFORE_CHANGING_HOMES: Statement = ['LOCK TABLE homes IN SHARE MODE'];

/** Seeds `count` homes with `resident` as their only resident and returns their ids. */
async function seedHomes(run: PostgresRun, resident: ResidentIdentity, count: number) {
  const homes: number[] = [];
  for (let index = 0; index < count; index += 1) homes.push((await seedHome(run.admin, `Casa ${index + 1}`, [resident.email])).id);
  return homes;
}

/** A browser of the run connecting to a home under a name of its own. */
function registration(run: PostgresRun, homeId: number, index: number) {
  return { homeId, name: `Teléfono ${index}`, subscription: pushSubscription(`${run.id}-phone-${index}`) };
}

/** Connects `count` devices to the home one after the other. */
async function connectDevices(run: PostgresRun, homeId: number, owner: ResidentIdentity, count: number) {
  for (let index = 0; index < count; index += 1) await saveDevice(run.admin, registration(run, homeId, index), owner, NO_BOOTSTRAP);
}

async function deviceCount(database: Database, homeId: number) {
  return (await database.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM device_homes WHERE home_id = $1', [homeId])).rows[0].count;
}

describe.skipIf(!TEST_POSTGRES_URL)('límites y borrados concurrentes contra PostgreSQL real', () => {
  let run: PostgresRun;

  beforeAll(async () => {
    run = await openRun();
    return () => run.close();
  });

  test(`${CONCURRENT_REQUESTS} celulares que se conectan a la vez a una casa con ${DEVICES.max - 1} no pasan el límite de ${DEVICES.max}`, async () => {
    const owner = residentOf(run, 'devices');
    const home = await seedHome(run.admin, `Casa ${run.id} celulares`, [owner.email]);
    await connectDevices(run, home.id, owner, DEVICES.max - 1);

    const outcomes = await run.lineUp(BEFORE_STORING_DEVICES, spread(run.instances, CONCURRENT_REQUESTS, (instance, index) => saveDevice(instance, registration(run, home.id, DEVICES.max + index), owner, NO_BOOTSTRAP)));

    expect(fulfilledValues(outcomes)).toHaveLength(1);
    expect(await errorAnswers(outcomes)).toEqual(Array.from({ length: CONCURRENT_REQUESTS - 1 }, () => ({ status: HTTP.conflict, code: 'DEVICE_LIMIT' })));
    expect(await deviceCount(run.admin, home.id)).toBe(DEVICES.max);
  });

  test(`${CONCURRENT_REQUESTS} casas creadas a la vez por quien tiene ${HOMES.maxPerResident - 1} no pasan el límite de ${HOMES.maxPerResident}`, async () => {
    const resident = residentOf(run, 'creator');
    await seedHomes(run, resident, HOMES.maxPerResident - 1);

    const outcomes = await run.lineUp(BEFORE_CHANGING_HOMES, spread(run.instances, CONCURRENT_REQUESTS, (instance, index) => createHome(instance, resident, `Casa nueva ${index}`, NO_BOOTSTRAP)));

    expect(fulfilledValues(outcomes)).toHaveLength(1);
    expect(await errorAnswers(outcomes)).toEqual(Array.from({ length: CONCURRENT_REQUESTS - 1 }, () => ({ status: HTTP.conflict, code: 'HOME_LIMIT' })));
    expect(await listResidentHomes(run.admin, resident, NO_BOOTSTRAP)).toHaveLength(HOMES.maxPerResident);
  });

  test(`${CONCURRENT_REQUESTS} eliminaciones a la vez de todas las casas de una persona le dejan la última`, async () => {
    const resident = residentOf(run, 'deleter');
    const homes = await seedHomes(run, resident, CONCURRENT_REQUESTS);

    const outcomes = await run.lineUp(BEFORE_CHANGING_HOMES, spread(run.instances, CONCURRENT_REQUESTS, (instance, index) => deleteHome(instance, resident, homes[index], NO_BOOTSTRAP)));

    expect(fulfilledValues(outcomes)).toHaveLength(CONCURRENT_REQUESTS - 1);
    expect(await errorAnswers(outcomes)).toEqual([{ status: HTTP.conflict, code: 'LAST_HOME' }]);
    // The home left is the one whose deletion found no other home to keep.
    const kept = homes[outcomes.findIndex((outcome) => outcome.status === 'rejected')];
    expect((await listResidentHomes(run.admin, resident, NO_BOOTSTRAP)).map((home) => home.id)).toEqual([kept]);
  });
});
