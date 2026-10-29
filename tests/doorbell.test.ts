import { test, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { initialize, type Database } from '../src/server/database';
import { registerVisit, getHome, answerVisit, readVisit, snapshot } from '../src/server/doorbell';
import { AppError } from '../src/server/errors';
import { subscriptionSchema, saveDevice } from '../src/server/push';

const postgres = new PGlite();
const database: Database = {
  query: (sql, params) => postgres.query(sql, params),
  transaction: (work) => postgres.transaction((transaction) => work({ query: (sql, params) => transaction.query(sql, params), transaction: async () => { throw new Error('Nested transactions are unsupported'); } })),
};
beforeAll(async () => { await initialize(database); });
afterAll(async () => { await postgres.close(); });

test('registra una visita una sola vez y conserva el mensaje original ante reintentos', async () => {
  const home = await getHome(database);
  const id = crypto.randomUUID();
  const first = await registerVisit(database, home.token, id, 'Soy del delivery');
  const retry = await registerVisit(database, home.token, id, 'Mensaje distinto');
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  const state = await snapshot(database);
  assert.equal(state.visits.length, 1);
  assert.equal(state.visits[0].message, 'Soy del delivery');
});

test('el cooldown compartido impide timbrazos concurrentes con IDs diferentes', async () => {
  await database.query('DELETE FROM visits');
  const home = await getHome(database);
  const results = await Promise.allSettled([registerVisit(database, home.token, crypto.randomUUID(), ''), registerVisit(database, home.token, crypto.randomUUID(), '')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof AppError);
  assert.equal(rejected.reason.code, 'COOLDOWN');
});

test('el residente responde y el visitante recibe una confirmación idempotente sin datos privados', async () => {
  const home = await getHome(database);
  const state = await snapshot(database);
  const first = await answerVisit(database, state.visits[0].id);
  const second = await answerVisit(database, state.visits[0].id);
  assert.equal(new Date(first.answered_at!).getTime(), new Date(second.answered_at!).getTime());
  const publicVisit = await readVisit(database, home.token, state.visits[0].id);
  assert.ok(publicVisit.answered_at);
  assert.equal('message' in publicVisit, false);
  assert.equal('token' in publicVisit, false);
});

test('los timbrazos vencidos no se pueden atender', async () => {
  const id = crypto.randomUUID();
  await database.query(`INSERT INTO visits (id, message, created_at) VALUES ($1, '', NOW() - INTERVAL '5 minutes')`, [id]);
  await assert.rejects(answerVisit(database, id), (error: unknown) => error instanceof AppError && error.code === 'VISIT_EXPIRED');
});

test('pausar y rotar el QR revoca el acceso para tocar el timbre', async () => {
  const home = await getHome(database);
  await database.query('UPDATE homes SET enabled = FALSE WHERE id = 1');
  await assert.rejects(registerVisit(database, home.token, crypto.randomUUID(), ''), (error: unknown) => error instanceof AppError && error.code === 'PAUSED');
  await database.query('UPDATE homes SET token = $1, enabled = TRUE WHERE id = 1', [crypto.randomUUID()]);
  await assert.rejects(registerVisit(database, home.token, crypto.randomUUID(), ''), (error: unknown) => error instanceof AppError && error.code === 'INVALID_DOORBELL');
});

test('las suscripciones rechazan endpoints privados y guardan un solo dispositivo por endpoint', async () => {
  const keys = { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) };
  assert.equal(subscriptionSchema.safeParse({ endpoint: 'https://127.0.0.1/internal', keys }).success, false);
  assert.equal(subscriptionSchema.safeParse({ endpoint: 'https://fcm.googleapis.com.evil.example/send', keys }).success, false);
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-device', keys };
  assert.equal(subscriptionSchema.safeParse(subscription).success, true);
  await saveDevice(database, 'Mi celular', subscription);
  await saveDevice(database, 'Mi teléfono', subscription);
  const state = await snapshot(database);
  assert.equal(state.devices.length, 1);
  assert.equal(state.devices[0].name, 'Mi teléfono');
});
