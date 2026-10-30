import { test, beforeAll, beforeEach, afterAll, describe } from 'vitest';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { initialize, MIGRATIONS, type Database } from '../src/server/database';
import { registerVisit, getHome, answerVisit, readVisit, snapshot, leaveNote, publicHome, updateQuietHours } from '../src/server/doorbell';
import { AppError } from '../src/server/errors';
import { subscriptionSchema, saveDevice, pushPayload } from '../src/server/push';
import { ringClientKey } from '../src/server/rate-limit';
import { isQuietTime, localMinutes } from '../src/lib/quiet-hours';
import { RING_LIMITS } from '../src/constants/doorbell';

function adapter(postgres: PGlite): Database {
  return {
    query: (sql, params) => postgres.query(sql, params),
    transaction: (work) => postgres.transaction((transaction) => work({ query: (sql, params) => transaction.query(sql, params), transaction: async () => { throw new Error('Nested transactions are unsupported'); } })),
  };
}

const postgres = new PGlite();
const database = adapter(postgres);
const code = (expected: string) => (error: unknown) => error instanceof AppError && error.code === expected;
const age = (id: string, seconds: number) => database.query(`UPDATE visits SET created_at = NOW() - $2 * INTERVAL '1 second' WHERE id = $1`, [id, seconds]);
const clearCooldowns = () => database.query(`DELETE FROM rate_limits WHERE key LIKE 'ring-cooldown:%'`);

beforeAll(async () => { await initialize(database); });
afterAll(async () => { await postgres.close(); });
beforeEach(async () => {
  await database.query('DELETE FROM visits');
  await database.query('DELETE FROM rate_limits');
  await database.query('UPDATE homes SET enabled = TRUE, quiet_start = NULL, quiet_end = NULL WHERE id = 1');
});

describe('timbrazos', () => {
  test('registra una visita una sola vez y conserva el mensaje original ante reintentos', async () => {
    const home = await getHome(database);
    const id = crypto.randomUUID();
    const first = await registerVisit(database, home.token, id, 'Soy del delivery', 'visitor-a');
    const retry = await registerVisit(database, home.token, id, 'Mensaje distinto', 'visitor-a');
    assert.equal(first.created, true);
    assert.equal(retry.created, false);
    const state = await snapshot(database);
    assert.equal(state.visits.length, 1);
    assert.equal(state.visits[0].message, 'Soy del delivery');
  });

  test('el cooldown por cliente impide timbrazos concurrentes del mismo visitante', async () => {
    const home = await getHome(database);
    const results = await Promise.allSettled([registerVisit(database, home.token, crypto.randomUUID(), '', 'visitor-a'), registerVisit(database, home.token, crypto.randomUUID(), '', 'visitor-a')]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.ok(rejected?.status === 'rejected' && code('COOLDOWN')(rejected.reason));
  });

  test('un visitante insistente no bloquea a otro que llega después', async () => {
    const home = await getHome(database);
    await registerVisit(database, home.token, crypto.randomUUID(), 'spam', 'visitor-a');
    await assert.rejects(registerVisit(database, home.token, crypto.randomUUID(), 'spam', 'visitor-a'), code('COOLDOWN'));
    const real = await registerVisit(database, home.token, crypto.randomUUID(), 'Soy el cartero', 'visitor-b');
    assert.equal(real.created, true);
  });

  test('cada cliente tiene un máximo de timbrazos por ventana', async () => {
    const home = await getHome(database);
    for (let index = 0; index < RING_LIMITS.clientMaxPerWindow; index += 1) {
      await clearCooldowns();
      await registerVisit(database, home.token, crypto.randomUUID(), '', 'visitor-a');
    }
    await clearCooldowns();
    await assert.rejects(registerVisit(database, home.token, crypto.randomUUID(), '', 'visitor-a'), code('RATE_LIMITED'));
  });

  test('la casa tiene un tope de avisos aunque lleguen de clientes distintos', async () => {
    const home = await getHome(database);
    for (let index = 0; index < RING_LIMITS.homeMaxPerWindow; index += 1) await registerVisit(database, home.token, crypto.randomUUID(), '', `visitor-${index}`);
    await assert.rejects(registerVisit(database, home.token, crypto.randomUUID(), '', 'visitor-new'), code('BUSY'));
  });

  test('un reintento con el mismo ID no consume el límite del cliente', async () => {
    const home = await getHome(database);
    const id = crypto.randomUUID();
    await registerVisit(database, home.token, id, '', 'visitor-a');
    const retry = await registerVisit(database, home.token, id, '', 'visitor-a');
    assert.equal(retry.created, false);
  });

  test('pausar y rotar el QR revoca el acceso para tocar el timbre', async () => {
    const home = await getHome(database);
    await database.query('UPDATE homes SET enabled = FALSE WHERE id = 1');
    await assert.rejects(registerVisit(database, home.token, crypto.randomUUID(), '', 'visitor-a'), code('PAUSED'));
    await database.query('UPDATE homes SET token = $1, enabled = TRUE WHERE id = 1', [crypto.randomUUID()]);
    await assert.rejects(registerVisit(database, home.token, crypto.randomUUID(), '', 'visitor-a'), code('INVALID_DOORBELL'));
  });
});

describe('respuestas', () => {
  test('la primera respuesta gana: se conservan hora, respuesta y residente ante reintentos', async () => {
    const home = await getHome(database);
    const id = crypto.randomUUID();
    await registerVisit(database, home.token, id, 'Hola', 'visitor-a');
    const first = await answerVisit(database, id, 'leave', 'Guido');
    const second = await answerVisit(database, id, 'coming', 'Otra persona');
    assert.equal(new Date(first.answered_at!).getTime(), new Date(second.answered_at!).getTime());
    assert.equal(second.reply, 'leave');
    assert.equal(second.answered_by, 'Guido');
  });

  test('el visitante ve la respuesta sin el mensaje, la nota ni quién respondió', async () => {
    const home = await getHome(database);
    const id = crypto.randomUUID();
    await registerVisit(database, home.token, id, 'Soy Juan', 'visitor-a');
    await answerVisit(database, id, 'soon', 'Guido');
    const publicVisit = await readVisit(database, home.token, id);
    assert.equal(publicVisit.reply, 'soon');
    assert.ok(publicVisit.answered_at);
    for (const key of ['message', 'note', 'answered_by', 'token']) assert.equal(key in publicVisit, false);
  });

  test('los timbrazos vencidos no se pueden atender', async () => {
    const id = crypto.randomUUID();
    await database.query(`INSERT INTO visits (id, message, created_at) VALUES ($1, '', NOW() - INTERVAL '5 minutes')`, [id]);
    await assert.rejects(answerVisit(database, id), code('VISIT_EXPIRED'));
  });
});

describe('mensajes del visitante', () => {
  test('no se puede dejar un mensaje mientras todavía pueden responder', async () => {
    const home = await getHome(database);
    const id = crypto.randomUUID();
    await registerVisit(database, home.token, id, '', 'visitor-a');
    await assert.rejects(leaveNote(database, home.token, id, 'Hola'), code('NOTE_UNAVAILABLE'));
  });

  test('tras vencer se acepta un único mensaje y el reintento no lo duplica', async () => {
    const home = await getHome(database);
    const id = crypto.randomUUID();
    await registerVisit(database, home.token, id, '', 'visitor-a');
    await age(id, 180);
    const first = await leaveNote(database, home.token, id, 'Llamame al 11 5555 5555');
    const retry = await leaveNote(database, home.token, id, 'Otro mensaje');
    assert.equal(first.created, true);
    assert.equal(retry.created, false);
    assert.equal(retry.visit.noted, true);
    const state = await snapshot(database);
    assert.equal(state.visits[0].note, 'Llamame al 11 5555 5555');
  });

  test('si avisan que no están, el visitante puede dejar un mensaje enseguida', async () => {
    const home = await getHome(database);
    const id = crypto.randomUUID();
    await registerVisit(database, home.token, id, '', 'visitor-a');
    await answerVisit(database, id, 'away', 'Guido');
    assert.equal((await leaveNote(database, home.token, id, 'Vuelvo mañana')).created, true);
  });

  test('pasada la ventana de mensajes ya no se aceptan', async () => {
    const home = await getHome(database);
    const id = crypto.randomUUID();
    await registerVisit(database, home.token, id, '', 'visitor-a');
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
    await updateQuietHours(database, format(current - 5), format(current + 60));
    const home = await getHome(database);
    assert.deepEqual(await publicHome(database, home.token), { name: home.name, enabled: true, quiet: true, quietUntil: format(current + 60) });
    await assert.rejects(registerVisit(database, home.token, crypto.randomUUID(), '', 'visitor-a'), code('QUIET_HOURS'));
    await updateQuietHours(database, null, null);
    assert.equal((await registerVisit(database, home.token, crypto.randomUUID(), '', 'visitor-a')).created, true);
  });

  test('rechaza horarios incompletos o con inicio igual al fin', async () => {
    await assert.rejects(updateQuietHours(database, '22:00', null), code('INVALID_QUIET_HOURS'));
    await assert.rejects(updateQuietHours(database, '22:00', '22:00'), code('INVALID_QUIET_HOURS'));
  });
});

describe('migraciones', () => {
  test('una base nueva queda en la última versión y repetir no cambia nada', async () => {
    const fresh = new PGlite();
    try {
      const db = adapter(fresh);
      await initialize(db);
      const token = (await getHome(db)).token;
      await initialize(db);
      const versions = await db.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version');
      assert.deepEqual(versions.rows.map((row) => row.version), MIGRATIONS.map((_, index) => index + 1));
      assert.equal((await getHome(db)).token, token);
    } finally { await fresh.close(); }
  });

  test('una base creada antes del versionado adopta las migraciones sin perder datos', async () => {
    const legacy = new PGlite();
    try {
      const db = adapter(legacy);
      for (const statement of MIGRATIONS[0]) {
        if (typeof statement === 'string') await db.query(statement);
        else await db.query(statement[0], statement[1]());
      }
      await db.query(`INSERT INTO visits (id, message) VALUES ('legacy-visit', 'Hola')`);
      await initialize(db);
      const visit = await db.query<{ message: string; reply: string | null }>(`SELECT message, reply FROM visits WHERE id = 'legacy-visit'`);
      assert.deepEqual(visit.rows[0], { message: 'Hola', reply: null });
    } finally { await legacy.close(); }
  });
});

describe('avisos', () => {
  test('la notificación abre la visita y solo ofrece respuestas cuando se puede responder', () => {
    const id = crypto.randomUUID();
    const ring = pushPayload({ title: 'Hay alguien en la puerta', body: 'Hola', visitId: id, answerable: true });
    assert.equal(ring.url, `/?view=history&visit=${id}`);
    assert.equal(ring.tag, id);
    assert.deepEqual(ring.replies.map((item) => item.reply), ['coming', 'leave']);
    assert.deepEqual(pushPayload({ title: 'Te dejaron un mensaje', body: 'Hola', visitId: id }).replies, []);
    assert.equal(pushPayload({ title: 'Prueba', body: 'Prueba' }).url, '/');
  });

  test('el cliente se identifica con un hash, sin guardar su dirección', () => {
    const headers = (value: string) => new Headers({ 'x-forwarded-for': value });
    const first = ringClientKey(headers('203.0.113.7, 10.0.0.1'), 'secret');
    assert.equal(first, ringClientKey(headers('203.0.113.7'), 'secret'));
    assert.notEqual(first, ringClientKey(headers('203.0.113.8'), 'secret'));
    assert.equal(first.includes('203.0.113.7'), false);
  });

  test('las suscripciones rechazan endpoints privados y guardan un solo dispositivo por endpoint', async () => {
    const keys = { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) };
    assert.equal(subscriptionSchema.safeParse({ endpoint: 'https://127.0.0.1/internal', keys }).success, false);
    assert.equal(subscriptionSchema.safeParse({ endpoint: 'https://fcm.googleapis.com.evil.example/send', keys }).success, false);
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-device', keys };
    assert.equal(subscriptionSchema.safeParse(subscription).success, true);
    const user = { id: 'device-test-user', email: 'device@example.com', emailVerified: true };
    const settings = { adminEmails: '', residentEmails: user.email };
    await saveDevice(database, 'Mi celular', subscription, user, settings);
    await saveDevice(database, 'Mi teléfono', subscription, user, settings);
    const state = await snapshot(database);
    assert.equal(state.devices.length, 1);
    assert.equal(state.devices[0].name, 'Mi teléfono');
  });
});
