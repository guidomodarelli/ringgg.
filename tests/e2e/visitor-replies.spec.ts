import { test, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { initialize } from '../../src/server/database';
import { answerVisit, getHome, leaveNote, publicHome, readVisit, registerVisit, setDelivery, snapshot } from '../../src/server/doorbell';
import { setHomeLocation, setNearbyOnly } from '../../src/server/location';
import { FIXTURE_HOME } from './support/dashboard-initial';
import { readBody, serveFixture as serve } from './support/visitor-fixture';
import { testDatabase } from '../support/test-database';

// Real React components, HTTP transport and PostgreSQL. Push providers and the resident session are outside the fixture.

test('el visitante ve "No están en casa" y deja un único mensaje aunque haga doble click', async ({ page }) => {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const home = await getHome(database, FIXTURE_HOME);
  let notes = 0;
  const fixture = await serve('tests/fixtures/visitor-entry.tsx', `window.__VISITOR__=${JSON.stringify({ home: { name: home.name, paused: false, pausedUntil: null, quiet: false, quietUntil: null }, token: home.token })}`, async (request, response, path) => {
    const [, token, , id, action] = path.split('/');
    if (request.method === 'POST' && !id) {
      const input = await readBody(request);
      const result = await registerVisit(database, token, { id: input.id, message: input.message, client: 'fixture-client' });
      if (result.created) await setDelivery(database, input.id, 'unavailable');
      response.end(JSON.stringify(await readVisit(database, token, input.id))); return true;
    }
    if (request.method === 'POST' && action === 'note') { notes += 1; const input = await readBody(request); response.end(JSON.stringify((await leaveNote(database, token, id, input.note)).visit)); return true; }
    if (request.method === 'GET' && id) { response.end(JSON.stringify(await readVisit(database, token, id))); return true; }
    return false;
  });
  try {
    await page.goto(fixture.url);
    await page.getByLabel('¿Querés decir quién sos?').fill('Soy Juan');
    await page.getByRole('button', { name: 'Tocar timbre', exact: true }).dblclick();
    await expect(page.getByRole('heading', { name: '¡Ding, dong!' })).toBeVisible();
    const [visit] = (await snapshot(database, FIXTURE_HOME)).visits;
    expect((await snapshot(database, FIXTURE_HOME)).visits).toHaveLength(1);
    await answerVisit(database, { homeId: FIXTURE_HOME, id: visit.id }, 'away', 'Guido');
    await expect(page.getByRole('heading', { name: 'No están en casa' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Guido')).toHaveCount(0);
    await page.getByLabel('Dejales un mensaje').fill('Vuelvo mañana a las 10');
    await page.getByRole('button', { name: 'Dejar mensaje' }).dblclick();
    await expect(page.getByText('Le dejamos tu mensaje.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dejar mensaje' })).toHaveCount(0);
    expect(notes).toBe(1);
    expect((await snapshot(database, FIXTURE_HOME)).visits[0].note).toBe('Vuelvo mañana a las 10');
  } finally { await fixture.close(); await postgres.close(); }
});

test('en horario de descanso el visitante no puede tocar y ve hasta cuándo', async ({ page }) => {
  let checks = 0;
  const fixture = await serve('tests/fixtures/visitor-entry.tsx', `window.__VISITOR__=${JSON.stringify({ home: { name: 'Casa', paused: false, pausedUntil: null, quiet: true, quietUntil: '08:00' }, token: 'token' })}`, async (request, response, path) => {
    if (request.method !== 'GET' || path !== 'door/token') return false;
    checks += 1; response.end(JSON.stringify({ name: 'Casa', paused: false, pausedUntil: null, quiet: false, quietUntil: null })); return true;
  });
  try {
    await page.clock.install();
    await page.goto(fixture.url);
    await expect(page.getByRole('heading', { name: 'Es horario de descanso' })).toBeVisible();
    await expect(page.getByText('El timbre vuelve a sonar a las 08:00.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tocar timbre' })).toHaveCount(0);
    // When quiet hours end the open page rechecks availability and shows the ring form.
    await page.clock.runFor(60_000);
    await expect(page.getByRole('button', { name: 'Tocar timbre' })).toBeVisible();
    expect(checks).toBe(1);
  } finally { await fixture.close(); }
});

test('con una pausa programada el visitante ve hasta cuándo y puede tocar cuando termina', async ({ page }) => {
  const pausedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const fixture = await serve('tests/fixtures/visitor-entry.tsx', `window.__VISITOR__=${JSON.stringify({ home: { name: 'Casa', paused: true, pausedUntil, quiet: false, quietUntil: null }, token: 'token' })}`, async (request, response, path) => {
    if (request.method !== 'GET' || path !== 'door/token') return false;
    response.end(JSON.stringify({ name: 'Casa', paused: false, pausedUntil: null, quiet: false, quietUntil: null })); return true;
  });
  try {
    await page.clock.install();
    await page.goto(fixture.url);
    await expect(page.getByRole('heading', { name: 'El timbre está en pausa' })).toBeVisible();
    await expect(page.getByText(/No se pueden enviar avisos hasta (mañana a )?las \d{2}:\d{2}\./)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tocar timbre' })).toHaveCount(0);
    await page.clock.runFor(60_000);
    await expect(page.getByRole('button', { name: 'Tocar timbre' })).toBeVisible();
  } finally { await fixture.close(); }
});

test('si la casa deja de pedir la ubicación, el visitante que no la compartió puede tocar sin recargar', async ({ page }) => {
  const fixture = await serve('tests/fixtures/visitor-entry.tsx', `window.__VISITOR__=${JSON.stringify({ home: { name: 'Casa', paused: false, pausedUntil: null, quiet: false, quietUntil: null, nearbyOnly: true }, token: 'token' })}`, async (request, response, path) => {
    if (request.method !== 'GET' || path !== 'door/token') return false;
    response.end(JSON.stringify({ name: 'Casa', paused: false, pausedUntil: null, quiet: false, quietUntil: null, nearbyOnly: false })); return true;
  });
  try {
    await page.clock.install();
    await page.goto(fixture.url);
    const gate = page.getByRole('dialog', { name: 'Este timbre necesita tu ubicación.' });
    // The browser in the test denies an ungranted location, like a visitor who blocked it.
    await gate.getByRole('button', { name: 'Permitir ubicación' }).click();
    await expect(gate.getByRole('alert')).toContainText('Bloqueaste la ubicación para esta página');
    await expect(page.getByRole('button', { name: 'Tocar timbre', exact: true })).toHaveCount(0);
    // A resident lifts the requirement: the open page rereads the home and releases the visitor.
    await page.clock.runFor(60_000);
    await expect(gate).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Tocar timbre', exact: true })).toBeVisible();
  } finally { await fixture.close(); }
});

test('el residente responde con una respuesta rápida y el historial muestra quién y cuánto tardó', async ({ page }) => {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const home = await getHome(database, FIXTURE_HOME);
  const id = crypto.randomUUID();
  await registerVisit(database, home.token, { id, message: 'Soy del correo', client: 'fixture-client' });
  await setDelivery(database, id, 'sent');
  let answers = 0;
  const fixture = await serve('tests/fixtures/visit-history-entry.tsx', `window.__VISITS__=${JSON.stringify((await snapshot(database, FIXTURE_HOME)).visits)}`, async (request, response, path) => {
    if (path === 'answer' && request.method === 'POST') { answers += 1; const input = await readBody(request); response.end(JSON.stringify(await answerVisit(database, { homeId: FIXTURE_HOME, id: input.id }, input.reply, 'Guido'))); return true; }
    if (path === 'dashboard') { response.end(JSON.stringify(await snapshot(database, FIXTURE_HOME))); return true; }
    return false;
  });
  try {
    await page.goto(fixture.url);
    const row = page.locator('.visit-row.focused');
    await expect(row).toContainText('Aviso enviado');
    for (const label of ['Ya voy', 'En 5 minutos', 'Dejalo en la puerta', 'No estoy']) await expect(row.getByRole('button', { name: label, exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Dejalo en la puerta', exact: true }).dblclick();
    await expect(page.getByRole('status')).toHaveText('Tu visita ya ve: «Dejalo en la puerta».');
    await expect(row.getByText('Atendido', { exact: true })).toBeVisible();
    await expect(row).toContainText('Guido · Pidió dejarlo en la puerta · respondió en');
    await expect(row.getByRole('button')).toHaveCount(0);
    expect(answers).toBe(1);
  } finally { await fixture.close(); await postgres.close(); }
});

test('si la casa pide estar en la puerta, sin ubicación no se puede tocar ni cerrar el aviso', async ({ page, context }) => {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const door = { latitude: -34.6037, longitude: -58.3816 };
  await setHomeLocation(database, FIXTURE_HOME, { ...door, accuracy: 10 });
  await setNearbyOnly(database, FIXTURE_HOME, true);
  const home = await getHome(database, FIXTURE_HOME);
  const fixture = await serve('tests/fixtures/visitor-entry.tsx', `window.__VISITOR__=${JSON.stringify({ home: await publicHome(database, home.token), token: home.token })}`, async (request, response, path) => {
    if (request.method !== 'POST' || path !== `door/${home.token}`) return false;
    const input = await readBody(request);
    const result = await registerVisit(database, home.token, { id: input.id, message: input.message, client: 'fixture-client', position: input.position });
    if (result.created) await setDelivery(database, input.id, 'unavailable');
    response.end(JSON.stringify(await readVisit(database, home.token, input.id))); return true;
  });
  try {
    await page.goto(fixture.url);
    const gate = page.getByRole('dialog', { name: 'Este timbre necesita tu ubicación.' });
    await expect(gate).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tocar timbre', exact: true })).toHaveCount(0);
    // The browser in the test denies an ungranted location, like a visitor who blocked it.
    await gate.getByRole('button', { name: 'Permitir ubicación' }).click();
    await expect(gate.getByRole('alert')).toContainText('Bloqueaste la ubicación para esta página');
    await page.keyboard.press('Escape');
    await expect(gate).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tocar timbre', exact: true })).toHaveCount(0);
    // Allowing it in the browser settings is noticed by the open page, from the door the visitor can ring.
    await context.setGeolocation({ latitude: door.latitude + 0.0004, longitude: door.longitude, accuracy: 20 });
    await context.grantPermissions(['geolocation'], { origin: fixture.url });
    await expect(gate).toHaveCount(0);
    await page.getByRole('button', { name: 'Tocar timbre', exact: true }).click();
    await expect(page.getByRole('heading', { name: '¡Ding, dong!' })).toBeVisible();
    expect((await snapshot(database, FIXTURE_HOME)).visits).toHaveLength(1);
  } finally { await fixture.close(); await postgres.close(); }
});

test('si la casa empieza a pedir la ubicación con la página abierta, el visitante la concede sin recargar y toca una sola vez', async ({ page, context }) => {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const door = { latitude: -34.6037, longitude: -58.3816 };
  await setHomeLocation(database, FIXTURE_HOME, { ...door, accuracy: 10 });
  const home = await getHome(database, FIXTURE_HOME);
  const fixture = await serve('tests/fixtures/visitor-entry.tsx', `window.__VISITOR__=${JSON.stringify({ home: await publicHome(database, home.token), token: home.token })}`, async (request, response, path) => {
    if (path !== `door/${home.token}`) return false;
    if (request.method === 'GET') { response.end(JSON.stringify(await publicHome(database, home.token))); return true; }
    const input = await readBody(request);
    const result = await registerVisit(database, home.token, { id: input.id, message: input.message, client: 'fixture-client', position: input.position });
    if (result.created) await setDelivery(database, input.id, 'unavailable');
    response.end(JSON.stringify(await readVisit(database, home.token, input.id))); return true;
  });
  try {
    await page.goto(fixture.url);
    const ringButton = page.getByRole('button', { name: 'Tocar timbre', exact: true });
    await expect(ringButton).toBeVisible();
    // A resident turns the requirement on after the visitor opened the page; the server rejects the ring without a location.
    await setNearbyOnly(database, FIXTURE_HOME, true);
    await ringButton.click();
    const gate = page.getByRole('dialog', { name: 'Este timbre necesita tu ubicación.' });
    await expect(gate).toBeVisible();
    expect((await snapshot(database, FIXTURE_HOME)).visits).toHaveLength(0);
    // Allowing it from the door releases the notice and the retry registers a single ring.
    await context.setGeolocation({ latitude: door.latitude + 0.0004, longitude: door.longitude, accuracy: 20 });
    await context.grantPermissions(['geolocation'], { origin: fixture.url });
    await expect(gate).toHaveCount(0);
    await ringButton.click();
    await expect(page.getByRole('heading', { name: '¡Ding, dong!' })).toBeVisible();
    expect((await snapshot(database, FIXTURE_HOME)).visits).toHaveLength(1);
  } finally { await fixture.close(); await postgres.close(); }
});

test('si la casa pide estar en la puerta, desde lejos el visitante ve que tiene que acercarse', async ({ page, context }) => {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const door = { latitude: -34.6037, longitude: -58.3816 };
  await setHomeLocation(database, FIXTURE_HOME, { ...door, accuracy: 10 });
  await setNearbyOnly(database, FIXTURE_HOME, true);
  const home = await getHome(database, FIXTURE_HOME);
  const fixture = await serve('tests/fixtures/visitor-entry.tsx', `window.__VISITOR__=${JSON.stringify({ home: await publicHome(database, home.token), token: home.token })}`, async (request, response, path) => {
    if (request.method !== 'POST' || path !== `door/${home.token}`) return false;
    const input = await readBody(request);
    await registerVisit(database, home.token, { id: input.id, message: input.message, client: 'fixture-client', position: input.position });
    return false;
  });
  try {
    await context.setGeolocation({ latitude: door.latitude + 0.02, longitude: door.longitude, accuracy: 20 });
    await context.grantPermissions(['geolocation'], { origin: fixture.url });
    await page.goto(fixture.url);
    await page.getByRole('button', { name: 'Tocar timbre', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Acercate para tocar el timbre');
    expect((await snapshot(database, FIXTURE_HOME)).visits).toHaveLength(0);
  } finally { await fixture.close(); await postgres.close(); }
});
