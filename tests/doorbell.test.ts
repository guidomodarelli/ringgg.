import { test, beforeAll, beforeEach, afterAll, describe } from 'vitest';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { initialize, MIGRATIONS, type Database } from '../src/server/database';
import { registerVisit, getHome, answerVisit, readVisit, snapshot, leaveNote, publicHome, updateQuietHours, setDelivery, setPause, updateHomeName, purgeExpiredData } from '../src/server/doorbell';
import { AppError } from '../src/server/errors';
import { subscriptionSchema, saveDevice, pushPayload } from '../src/server/push';
import { rateLimitSalt, ringClientKey } from '../src/server/rate-limit';
import { requireCronSecret } from '../src/server/cron';
import { isQuietTime, localMinutes } from '../src/lib/quiet-hours';
import { DOORBELL, RING_LIMITS } from '../src/constants/doorbell';
import { HOMES } from '../src/constants/homes';
import { testDatabase } from './support/test-database';

/** The original home, where every test of this file rings. */
const HOME = HOMES.originalId;

const postgres = new PGlite();
const database = testDatabase(postgres);
const code = (expected: string) => (error: unknown) => error instanceof AppError && error.code === expected;
const age = (id: string, seconds: number) => database.query(`UPDATE visits SET created_at = NOW() - $2 * INTERVAL '1 second' WHERE id = $1`, [id, seconds]);
const clearCooldowns = () => database.query(`DELETE FROM rate_limits WHERE key LIKE 'ring-cooldown:%'`);

beforeAll(async () => { await initialize(database); });
afterAll(async () => { await postgres.close(); });
beforeEach(async () => {
  await database.query('DELETE FROM visits');
  await database.query('DELETE FROM rate_limits');
  await database.query('UPDATE homes SET enabled = TRUE, paused_until = NULL, quiet_start = NULL, quiet_end = NULL WHERE id = 1');
});

describe('timbrazos', () => {
  test('registra una visita una sola vez y conserva el mensaje original ante reintentos', async () => {
    const home = await getHome(database, HOME);
    const id = crypto.randomUUID();
    const first = await registerVisit(database, home.token, { id, message: 'Soy del delivery', client: 'visitor-a' });
    const retry = await registerVisit(database, home.token, { id, message: 'Mensaje distinto', client: 'visitor-a' });
    assert.equal(first.created, true);
    assert.equal(retry.created, false);
    const state = await snapshot(database, HOME);
    assert.equal(state.visits.length, 1);
    assert.equal(state.visits[0].message, 'Soy del delivery');
  });

  test('el cooldown por cliente impide timbrazos concurrentes del mismo visitante', async () => {
    const home = await getHome(database, HOME);
    const results = await Promise.allSettled([registerVisit(database, home.token, { id: crypto.randomUUID(), message: '', client: 'visitor-a' }), registerVisit(database, home.token, { id: crypto.randomUUID(), message: '', client: 'visitor-a' })]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.ok(rejected?.status === 'rejected' && code('COOLDOWN')(rejected.reason));
  });

  test('un visitante insistente no bloquea a otro que llega después', async () => {
    const home = await getHome(database, HOME);
    await registerVisit(database, home.token, { id: crypto.randomUUID(), message: 'spam', client: 'visitor-a' });
    await assert.rejects(registerVisit(database, home.token, { id: crypto.randomUUID(), message: 'spam', client: 'visitor-a' }), code('COOLDOWN'));
    const real = await registerVisit(database, home.token, { id: crypto.randomUUID(), message: 'Soy el cartero', client: 'visitor-b' });
    assert.equal(real.created, true);
  });

  test('cada cliente tiene un máximo de timbrazos por ventana', async () => {
    const home = await getHome(database, HOME);
    for (let index = 0; index < RING_LIMITS.clientMaxPerWindow; index += 1) {
      await clearCooldowns();
      await registerVisit(database, home.token, { id: crypto.randomUUID(), message: '', client: 'visitor-a' });
    }
    await clearCooldowns();
    await assert.rejects(registerVisit(database, home.token, { id: crypto.randomUUID(), message: '', client: 'visitor-a' }), code('RATE_LIMITED'));
  });

  test('la casa tiene un tope de avisos aunque lleguen de clientes distintos', async () => {
    const home = await getHome(database, HOME);
    for (let index = 0; index < RING_LIMITS.homeMaxPerWindow; index += 1) await registerVisit(database, home.token, { id: crypto.randomUUID(), message: '', client: `visitor-${index}` });
    await assert.rejects(registerVisit(database, home.token, { id: crypto.randomUUID(), message: '', client: 'visitor-new' }), code('BUSY'));
  });

  test('un reintento con el mismo ID no consume el límite del cliente', async () => {
    const home = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await registerVisit(database, home.token, { id, message: '', client: 'visitor-a' });
    const retry = await registerVisit(database, home.token, { id, message: '', client: 'visitor-a' });
    assert.equal(retry.created, false);
  });

  test('pausar y rotar el QR revoca el acceso para tocar el timbre', async () => {
    const home = await getHome(database, HOME);
    await database.query('UPDATE homes SET enabled = FALSE WHERE id = 1');
    await assert.rejects(registerVisit(database, home.token, { id: crypto.randomUUID(), message: '', client: 'visitor-a' }), code('PAUSED'));
    await database.query('UPDATE homes SET token = $1, enabled = TRUE WHERE id = 1', [crypto.randomUUID()]);
    await assert.rejects(registerVisit(database, home.token, { id: crypto.randomUUID(), message: '', client: 'visitor-a' }), code('INVALID_DOORBELL'));
  });
});

describe('lecturas públicas', () => {
  test('la consulta del visitante valida el QR y distingue un timbrazo inexistente', async () => {
    const home = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await registerVisit(database, home.token, { id, message: 'Hola', client: 'visitor-a' });
    await assert.rejects(readVisit(database, 'otro-token', id), code('INVALID_DOORBELL'));
    await assert.rejects(readVisit(database, home.token, crypto.randomUUID()), code('VISIT_NOT_FOUND'));
    assert.deepEqual(Object.keys(await readVisit(database, home.token, id)).sort(), ['answered_at', 'created_at', 'delivery', 'id', 'noted', 'reply']);
  });

  test('guardar el estado del aviso devuelve la visita pública sin otra lectura', async () => {
    const home = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await registerVisit(database, home.token, { id, message: 'Hola', client: 'visitor-a' });
    const visit = await setDelivery(database, id, 'partial');
    assert.equal(visit.delivery, 'partial');
    assert.deepEqual(visit, await readVisit(database, home.token, id));
  });
});

describe('respuestas', () => {
  test('la primera respuesta gana: se conservan hora, respuesta y residente ante reintentos', async () => {
    const home = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await registerVisit(database, home.token, { id, message: 'Hola', client: 'visitor-a' });
    const first = await answerVisit(database, { homeId: HOME, id: id }, 'leave', 'Guido');
    const second = await answerVisit(database, { homeId: HOME, id: id }, 'coming', 'Otra persona');
    assert.equal(new Date(first.answered_at!).getTime(), new Date(second.answered_at!).getTime());
    assert.equal(second.reply, 'leave');
    assert.equal(second.answered_by, 'Guido');
  });

  test('el visitante ve la respuesta sin el mensaje, la nota ni quién respondió', async () => {
    const home = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await registerVisit(database, home.token, { id, message: 'Soy Juan', client: 'visitor-a' });
    await answerVisit(database, { homeId: HOME, id: id }, 'soon', 'Guido');
    const publicVisit = await readVisit(database, home.token, id);
    assert.equal(publicVisit.reply, 'soon');
    assert.ok(publicVisit.answered_at);
    for (const key of ['message', 'note', 'answered_by', 'token']) assert.equal(key in publicVisit, false);
  });

  test('los timbrazos vencidos no se pueden atender', async () => {
    const id = crypto.randomUUID();
    await database.query(`INSERT INTO visits (id, message, created_at) VALUES ($1, '', NOW() - INTERVAL '5 minutes')`, [id]);
    await assert.rejects(answerVisit(database, { homeId: HOME, id: id }), code('VISIT_EXPIRED'));
  });
});

describe('mensajes del visitante', () => {
  test('no se puede dejar un mensaje mientras todavía pueden responder', async () => {
    const home = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await registerVisit(database, home.token, { id, message: '', client: 'visitor-a' });
    await assert.rejects(leaveNote(database, home.token, id, 'Hola'), code('NOTE_UNAVAILABLE'));
  });

  test('tras vencer se acepta un único mensaje y el reintento no lo duplica', async () => {
    const home = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await registerVisit(database, home.token, { id, message: '', client: 'visitor-a' });
    await age(id, 180);
    const first = await leaveNote(database, home.token, id, 'Llamame al 11 5555 5555');
    const retry = await leaveNote(database, home.token, id, 'Otro mensaje');
    assert.equal(first.created, true);
    assert.equal(retry.created, false);
    assert.equal(retry.visit.noted, true);
    const state = await snapshot(database, HOME);
    assert.equal(state.visits[0].note, 'Llamame al 11 5555 5555');
  });

  test('si avisan que no están, el visitante puede dejar un mensaje enseguida', async () => {
    const home = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await registerVisit(database, home.token, { id, message: '', client: 'visitor-a' });
    await answerVisit(database, { homeId: HOME, id: id }, 'away', 'Guido');
    assert.equal((await leaveNote(database, home.token, id, 'Vuelvo mañana')).created, true);
  });

  test('pasada la ventana de mensajes ya no se aceptan', async () => {
    const home = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await registerVisit(database, home.token, { id, message: '', client: 'visitor-a' });
    await age(id, 60 * 60);
    await assert.rejects(leaveNote(database, home.token, id, 'Tarde'), code('NOTE_UNAVAILABLE'));
  });
});

describe('horario de descanso', () => {
  // 2026-10-30T02:00:00Z is 23:00 in Buenos Aires (UTC-3).
  const night = new Date('2026-10-30T02:00:00Z');
  const noon = new Date('2026-10-30T15:00:00Z');

  test('calcula la hora local de la casa y los rangos que cruzan la medianoche', () => {
    assert.equal(localMinutes(night), 23 * 60);
    assert.equal(isQuietTime({ quiet_start: '22:00', quiet_end: '08:00' }, night), true);
    assert.equal(isQuietTime({ quiet_start: '22:00', quiet_end: '08:00' }, noon), false);
    assert.equal(isQuietTime({ quiet_start: '11:00', quiet_end: '13:00' }, noon), true);
    assert.equal(isQuietTime({ quiet_start: null, quiet_end: null }, night), false);
    assert.equal(isQuietTime({ quiet_start: '10:00', quiet_end: '10:00' }, night), false);
  });

  test('durante el descanso no se registran timbrazos y el visitante ve hasta cuándo', async () => {
    const current = localMinutes(new Date());
    const format = (value: number) => `${String(Math.floor(((value + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((value + 1440) % 1440) % 60).padStart(2, '0')}`;
    await updateQuietHours(database, HOME, format(current - 5), format(current + 60));
    const home = await getHome(database, HOME);
    assert.deepEqual(await publicHome(database, home.token), { name: home.name, paused: false, pausedUntil: null, quiet: true, quietUntil: format(current + 60), nearbyOnly: false });
    await assert.rejects(registerVisit(database, home.token, { id: crypto.randomUUID(), message: '', client: 'visitor-a' }), code('QUIET_HOURS'));
    await updateQuietHours(database, HOME, null, null);
    assert.equal((await registerVisit(database, home.token, { id: crypto.randomUUID(), message: '', client: 'visitor-a' })).created, true);
  });

  test('rechaza horarios incompletos o con inicio igual al fin', async () => {
    await assert.rejects(updateQuietHours(database, HOME, '22:00', null), code('INVALID_QUIET_HOURS'));
    await assert.rejects(updateQuietHours(database, HOME, '22:00', '22:00'), code('INVALID_QUIET_HOURS'));
  });
});

describe('migraciones', () => {
  test('una base nueva queda en la última versión y repetir no cambia nada', async () => {
    const fresh = new PGlite();
    try {
      const db = testDatabase(fresh);
      await initialize(db);
      const token = (await getHome(db, HOME)).token;
      await initialize(db);
      const versions = await db.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version');
      assert.deepEqual(versions.rows.map((row) => row.version), MIGRATIONS.map((_, index) => index + 1));
      assert.equal((await getHome(db, HOME)).token, token);
    } finally { await fresh.close(); }
  });

  /** Applies the first versions by hand, as an older deployment left the database. */
  async function migrateUpTo(db: Database, versions: number) {
    for (const migration of MIGRATIONS.slice(0, versions)) {
      for (const step of migration) {
        if (typeof step === 'string') await db.query(step);
        else if (Array.isArray(step)) await db.query(step[0], step[1]());
        else await step(db);
      }
    }
  }

  test('una base creada antes del versionado adopta las migraciones sin perder datos', async () => {
    const legacy = new PGlite();
    try {
      const db = testDatabase(legacy);
      await migrateUpTo(db, 1);
      await db.query(`INSERT INTO visits (id, message) VALUES ('legacy-visit', 'Hola')`);
      await initialize(db);
      const visit = await db.query<{ message: string; reply: string | null; home_id: number }>(`SELECT message, reply, home_id FROM visits WHERE id = 'legacy-visit'`);
      assert.deepEqual(visit.rows[0], { message: 'Hola', reply: null, home_id: HOME });
    } finally { await legacy.close(); }
  });

  test('pasar a varias casas conserva residentes, revocaciones y celulares de la casa original, sin nombres repetidos', async () => {
    const singleHome = new PGlite();
    try {
      const db = testDatabase(singleHome);
      await migrateUpTo(db, 3);
      await db.query('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
      await db.query('INSERT INTO schema_migrations (version) VALUES (1), (2), (3)');
      await db.query(`INSERT INTO residents (email, invited_by) VALUES ('cami@example.com', 'owner')`);
      await db.query(`INSERT INTO resident_revocations (email) VALUES ('ex@example.com')`);
      for (const [id, endpoint] of [['device-a', 'https://fcm.googleapis.com/a'], ['device-b', 'https://fcm.googleapis.com/b']]) {
        await db.query(`INSERT INTO devices (id, name, endpoint, subscription) VALUES ($1, 'Mi celular', $2, '{}'::jsonb)`, [id, endpoint]);
      }
      await initialize(db);
      assert.deepEqual((await db.query('SELECT home_id, email FROM home_members')).rows, [{ home_id: HOME, email: 'cami@example.com' }]);
      assert.deepEqual((await db.query('SELECT home_id, email FROM home_revocations')).rows, [{ home_id: HOME, email: 'ex@example.com' }]);
      const devices = await db.query<{ device_id: string; home_id: number; name: string }>('SELECT device_id, home_id, name FROM device_homes ORDER BY device_id');
      assert.deepEqual(devices.rows, [{ device_id: 'device-a', home_id: HOME, name: 'Mi celular' }, { device_id: 'device-b', home_id: HOME, name: 'Mi celular 2' }]);
      // New homes take the next id; the original keeps 1.
      const created = await db.query<{ id: number }>(`INSERT INTO homes (name, token) VALUES ('Otra', 'otro-token') RETURNING id`);
      assert.equal(created.rows[0].id, HOME + 1);
    } finally { await singleHome.close(); }
  });
});

describe('avisos', () => {
  test('la notificación abre la visita y solo ofrece respuestas cuando se puede responder', () => {
    const id = crypto.randomUUID();
    const ring = pushPayload({ kind: 'ring', homeId: HOME, title: 'Hay alguien en la puerta', body: 'Hola', visitId: id, answerable: true });
    assert.equal(ring.url, `/?home=${HOME}&view=history&visit=${id}`);
    assert.equal(ring.tag, id);
    assert.equal(ring.kind, 'ring');
    assert.deepEqual(ring.replies.map((item) => item.reply), ['coming', 'leave']);
    assert.deepEqual(pushPayload({ kind: 'note', homeId: HOME, title: 'Te dejaron un mensaje', body: 'Hola', visitId: id }).replies, []);
    assert.equal(pushPayload({ kind: 'test', homeId: HOME, title: 'Prueba', body: 'Prueba' }).url, `/?home=${HOME}`);
  });

  test('el hash del cliente usa un secreto propio del deployment', () => {
    assert.equal(rateLimitSalt({ NEON_AUTH_COOKIE_SECRET: 'cookie-secret' }), 'cookie-secret');
    assert.equal(rateLimitSalt({ SELF_AUTH_SECRET: 'self-secret' }), 'self-secret');
    assert.equal(rateLimitSalt({}), RING_LIMITS.developmentSalt);
    assert.throws(() => rateLimitSalt({ VERCEL: '1' }), /RateLimit:rateLimitSalt/);
  });

  test('el cliente se identifica con un hash, sin guardar su dirección', () => {
    const headers = (value: string) => new Headers({ 'x-forwarded-for': value });
    const first = ringClientKey(headers('203.0.113.7, 10.0.0.1'), 'secret');
    assert.equal(first, ringClientKey(headers('203.0.113.7'), 'secret'));
    assert.notEqual(first, ringClientKey(headers('203.0.113.8'), 'secret'));
    assert.equal(first.includes('203.0.113.7'), false);
  });

  test('las suscripciones rechazan endpoints privados y guardan un solo dispositivo por endpoint, con el nombre que ya tenía', async () => {
    const keys = { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) };
    assert.equal(subscriptionSchema.safeParse({ endpoint: 'https://127.0.0.1/internal', keys }).success, false);
    assert.equal(subscriptionSchema.safeParse({ endpoint: 'https://fcm.googleapis.com.evil.example/send', keys }).success, false);
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-device', keys };
    assert.equal(subscriptionSchema.safeParse(subscription).success, true);
    const user = { id: 'device-test-user', email: 'device@example.com', emailVerified: true };
    const settings = { bootstrapEmails: [user.email] };
    await saveDevice(database, { homeId: HOME, name: 'Teléfono de prueba', subscription }, user, settings);
    await saveDevice(database, { homeId: HOME, name: 'Otro nombre', subscription }, user, settings);
    const state = await snapshot(database, HOME);
    assert.equal(state.devices.length, 1);
    // Activating notifications again on the same browser does not rename it: names are chosen in Devices.
    assert.equal(state.devices[0].name, 'Teléfono de prueba');
  });
});

describe('pausa del timbre', () => {
  test('una pausa de una hora rechaza timbrazos, avisa hasta cuándo y termina sola', async () => {
    const home = await getHome(database, HOME);
    await setPause(database, HOME, 'hour');
    const paused = await publicHome(database, home.token);
    assert.equal(paused.paused, true);
    assert.ok(paused.pausedUntil && new Date(paused.pausedUntil).getTime() > Date.now());
    await assert.rejects(registerVisit(database, home.token, { id: crypto.randomUUID(), message: '', client: 'visitor-a' }), (error) => code('PAUSED')(error) && /hasta (?:mañana a )?las \d{2}:\d{2}/.test((error as Error).message));
    await database.query(`UPDATE homes SET paused_until = NOW() - INTERVAL '1 second' WHERE id = 1`);
    assert.equal((await publicHome(database, home.token)).paused, false);
    assert.equal((await registerVisit(database, home.token, { id: crypto.randomUUID(), message: '', client: 'visitor-a' })).created, true);
  });

  test('pausar hasta la mañana termina a las 8 de la casa dentro de las próximas 24 horas', async () => {
    await setPause(database, HOME, 'morning');
    const { paused_until: pausedUntil } = await getHome(database, HOME);
    assert.ok(pausedUntil);
    const end = new Date(pausedUntil);
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: DOORBELL.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(end);
    assert.equal(local, '08:00');
    assert.ok(end.getTime() > Date.now() && end.getTime() - Date.now() <= 24 * 60 * 60 * 1000);
  });

  test('pausar sin fecha espera a que alguien lo reactive', async () => {
    const home = await getHome(database, HOME);
    await setPause(database, HOME, 'indefinite');
    assert.deepEqual(await publicHome(database, home.token), { name: home.name, paused: true, pausedUntil: null, quiet: false, quietUntil: null, nearbyOnly: false });
    await assert.rejects(registerVisit(database, home.token, { id: crypto.randomUUID(), message: '', client: 'visitor-a' }), code('PAUSED'));
    await setPause(database, HOME, 'resume');
    assert.equal((await publicHome(database, home.token)).paused, false);
  });

  test('guardar el nombre de la casa no reactiva un timbre pausado', async () => {
    await setPause(database, HOME, 'indefinite');
    await updateHomeName(database, { id: 'home-name-test', email: 'name@example.com', emailVerified: true, homeId: HOME, displayName: null }, 'Casa de prueba');
    const state = await snapshot(database, HOME);
    assert.equal(state.home.name, 'Casa de prueba');
    assert.equal(state.home.paused, true);
  });
});

describe('retención', () => {
  test('el panel solo muestra visitas recientes y la purga diaria borra las viejas y sus recibos', async () => {
    const recent = crypto.randomUUID();
    const old = crypto.randomUUID();
    await database.query(`INSERT INTO visits (id, message) VALUES ($1, 'Reciente')`, [recent]);
    await database.query(`INSERT INTO visits (id, message, created_at) VALUES ($1, 'Vieja', NOW() - ($2 + 1) * INTERVAL '1 day')`, [old, DOORBELL.retentionDays]);
    await database.query(`INSERT INTO visit_receipts (visit_id, device_id) VALUES ($1, 'device')`, [old]);
    await database.query(`INSERT INTO rate_limits (key, attempts, expires_at) VALUES ('expired', 1, NOW() - INTERVAL '1 minute'), ('active', 1, NOW() + INTERVAL '1 minute')`);
    assert.deepEqual((await snapshot(database, HOME)).visits.map((visit) => visit.message), ['Reciente']);
    assert.deepEqual(await purgeExpiredData(database), { visits: 1, rateLimits: 1 });
    assert.equal((await database.query('SELECT visit_id FROM visit_receipts')).rows.length, 0);
    assert.deepEqual((await database.query<{ key: string }>('SELECT key FROM rate_limits')).rows, [{ key: 'active' }]);
  });

  test('la tarea programada exige el secreto de Vercel Cron y falla cerrada sin él', () => {
    const request = (authorization?: string) => new Request('https://ringgg.test/api/cron/purge', { headers: authorization ? { authorization } : {} });
    assert.throws(() => requireCronSecret(request('Bearer secret-value'), ''), code('CRON_NOT_CONFIGURED'));
    assert.throws(() => requireCronSecret(request(), 'secret-value'), code('CRON_UNAUTHORIZED'));
    assert.throws(() => requireCronSecret(request('Bearer otro-valor'), 'secret-value'), code('CRON_UNAUTHORIZED'));
    assert.doesNotThrow(() => requireCronSecret(request('Bearer secret-value'), 'secret-value'));
  });
});
