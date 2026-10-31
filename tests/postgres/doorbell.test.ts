import { randomUUID } from 'node:crypto';
import nock from 'nock';
import { beforeAll, describe, expect, test } from 'vitest';
import { followVisit, registerVisit } from '../../src/server/doorbell';
import { saveDevice } from '../../src/server/push';
import { HTTP } from '../../src/constants/doorbell';
import type { Database } from '../../src/server/database';
import { PUSH_SERVICE, pushSubscription, withProvider } from '../support/push-subscription';
import { TEST_POSTGRES_URL, errorAnswers, fulfilledValues, openRun, residentOf, seedHome, spread, type PostgresRun, type Statement } from '../support/postgres-run';

/** Requests at once: every connection of the two instances, three each as in production. */
const CONCURRENT_REQUESTS = 6;
const VISITOR = 'same-visitor';
const NO_BOOTSTRAP = { bootstrapEmails: [] };
/**
 * Held from another connection, it stops each ring right before it stores its visit, after it read the visitor's
 * limits (and whether the id exists): without the home lock, every ring would read them before any stores one.
 */
const BEFORE_STORING_VISITS: Statement = ['LOCK TABLE visits IN SHARE MODE'];

/** The ids of a home's visits. */
async function visitsOf(database: Database, homeId: number) {
  return (await database.query<{ id: string }>('SELECT id FROM visits WHERE home_id = $1', [homeId])).rows.map((visit) => visit.id);
}

/** The push service takes every notice for the phone at `path`; `received` counts them. */
function phoneAt(path: string) {
  const phone = { received: 0 };
  nock(PUSH_SERVICE).persist().post(`/${path}`).reply(201, () => { phone.received += 1; return ''; });
  return phone;
}

/**
 * Ways a ring's notice is due again with nobody sending it, and the lock that makes every poll reach the claim at
 * once. The claim is a request limit whose key names the visit.
 */
const DUE_NOTICES: Array<{ due: string; leave: (visitId: string) => Statement; hold: (visitId: string) => Statement }> = [
  {
    due: 'venció el reclamo de su pedido',
    leave: (visitId) => [`UPDATE rate_limits SET expires_at = NOW() - INTERVAL '1 second' WHERE strpos(key, $1) > 0`, [visitId]],
    hold: (visitId) => ['SELECT key FROM rate_limits WHERE strpos(key, $1) > 0 FOR UPDATE', [visitId]],
  },
  {
    due: 'el envío falló y liberó el reclamo',
    leave: (visitId) => ['DELETE FROM rate_limits WHERE strpos(key, $1) > 0', [visitId]],
    hold: () => ['LOCK TABLE rate_limits IN SHARE MODE'],
  },
];

describe.skipIf(!TEST_POSTGRES_URL)('timbrazos concurrentes contra PostgreSQL real', () => {
  let run: PostgresRun;

  beforeAll(async () => {
    run = await openRun();
    return () => run.close();
  });

  test(`${CONCURRENT_REQUESTS} timbrazos a la vez del mismo visitante crean una sola visita y los demás reciben COOLDOWN`, async () => {
    const home = await seedHome(run.admin, `Casa ${run.id} cooldown`);

    const outcomes = await run.lineUp(BEFORE_STORING_VISITS, spread(run.instances, CONCURRENT_REQUESTS, (instance) => registerVisit(instance, home.token, { id: randomUUID(), message: '', client: VISITOR })));

    expect(fulfilledValues(outcomes).map((submission) => submission.created)).toEqual([true]);
    expect(await errorAnswers(outcomes)).toEqual(Array.from({ length: CONCURRENT_REQUESTS - 1 }, () => ({ status: HTTP.tooMany, code: 'COOLDOWN' })));
    expect(await visitsOf(run.admin, home.id)).toHaveLength(1);
  });

  test('dos timbrazos a la vez con el mismo id crean la visita una vez y el otro la devuelve como existente', async () => {
    const home = await seedHome(run.admin, `Casa ${run.id} reintento`);
    const ring = { id: randomUUID(), message: 'Soy del delivery', client: VISITOR };

    const outcomes = await run.lineUp(BEFORE_STORING_VISITS, spread(run.instances, 2, (instance) => registerVisit(instance, home.token, ring)));

    expect(await errorAnswers(outcomes)).toEqual([]);
    expect(fulfilledValues(outcomes).map(({ created, visit }) => ({ created, id: visit.id })).toSorted((first, second) => Number(first.created) - Number(second.created))).toEqual([{ created: false, id: ring.id }, { created: true, id: ring.id }]);
    expect(await visitsOf(run.admin, home.id)).toEqual([ring.id]);
  });

  test.each(DUE_NOTICES)(`si $due, ${CONCURRENT_REQUESTS} consultas a la vez de la visita avisan a la casa una sola vez`, async ({ leave, hold }) => {
    const owner = residentOf(run, 'owner');
    const home = await seedHome(run.admin, `Casa ${run.id} aviso`, [owner.email]);
    const phonePath = `${run.id}-${randomUUID()}`;
    await saveDevice(run.admin, { homeId: home.id, name: 'Celu de la cocina', subscription: pushSubscription(phonePath) }, owner, NO_BOOTSTRAP);
    const { visit } = await registerVisit(run.admin, home.token, { id: randomUUID(), message: 'Hola', client: VISITOR });
    await run.admin.query(...leave(visit.id));

    await withProvider(async () => {
      const phone = phoneAt(phonePath);

      const outcomes = await run.lineUp(hold(visit.id), spread(run.instances, CONCURRENT_REQUESTS, (instance) => followVisit(instance, home.token, visit.id)));

      expect(await errorAnswers(outcomes)).toEqual([]);
      expect(fulfilledValues(outcomes).map((polled) => polled.delivery).toSorted()).toEqual([...Array.from({ length: CONCURRENT_REQUESTS - 1 }, () => 'registered'), 'sent']);
      expect(phone.received).toBe(1);
    });
  });
});
