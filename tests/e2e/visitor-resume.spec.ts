import { test, expect, type BrowserContext } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { DOORBELL } from '../../src/constants/doorbell';
import { TIME } from '../../src/constants/time';
import { initialize, type Database } from '../../src/server/database';
import { answerVisit, getHome, leaveNote, publicHome, readVisit, registerVisit, setDelivery, snapshot } from '../../src/server/doorbell';
import { FIXTURE_HOME } from './support/dashboard-initial';
import { readBody, serveFixture } from './support/visitor-fixture';
import { testDatabase } from '../support/test-database';

// Real React components, HTTP transport, browser storage and PostgreSQL, with the server's rate limits. Push is outside.

/** The visitor page of the original home, answering like the door's API routes. */
async function serveDoor(database: Database) {
  const home = await getHome(database, FIXTURE_HOME);
  const fixture = await serveFixture('tests/fixtures/visitor-entry.tsx', `window.__VISITOR__=${JSON.stringify({ home: await publicHome(database, home.token), token: home.token })}`, async (request, response, path) => {
    const [, token, , id, action] = path.split('/');
    if (request.method === 'POST' && !id) {
      const input = await readBody(request);
      const result = await registerVisit(database, token, { id: input.id, message: input.message, client: 'fixture-client', position: input.position });
      if (result.created) await setDelivery(database, input.id, 'sent');
      response.end(JSON.stringify(await readVisit(database, token, input.id))); return true;
    }
    if (request.method === 'POST' && action === 'note') { const input = await readBody(request); response.end(JSON.stringify((await leaveNote(database, token, id, input.note)).visit)); return true; }
    if (request.method === 'GET' && id) { response.end(JSON.stringify(await readVisit(database, token, id))); return true; }
    if (request.method === 'GET') { response.end(JSON.stringify(await publicHome(database, token))); return true; }
    return false;
  });
  return { ...fixture, token: home.token };
}

/** Status of every ring that reaches the server from any tab of the visitor. */
function ringStatuses(context: BrowserContext, token: string) {
  const statuses: number[] = [];
  context.on('response', (response) => { if (response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/door/${token}`) statuses.push(response.status()); });
  return statuses;
}

/** Moves a visit back in time, as if the visitor had been waiting that long. */
async function age(database: Database, visitId: string, seconds: number) {
  await database.query(`UPDATE visits SET created_at = NOW() - $2 * INTERVAL '1 second' WHERE id = $1`, [visitId, seconds]);
}

test('si la visita recarga o vuelve a escanear el QR, sigue esperando el mismo timbrazo y ve la respuesta', async ({ page, context }) => {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const door = await serveDoor(database);
  const rings = ringStatuses(context, door.token);
  try {
    await page.goto(door.url);
    await page.getByLabel('¿Querés decir quién sos?').fill('Soy Juan');
    await page.getByRole('button', { name: 'Tocar timbre', exact: true }).click();
    await expect(page.getByRole('heading', { name: '¡Ding, dong!' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: '¡Ding, dong!' })).toBeVisible();
    await expect(page.getByText('Esperando respuesta')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tocar timbre', exact: true })).toHaveCount(0);
    // Scanning the QR again opens the page in another tab of the same browser.
    const rescan = await context.newPage();
    await rescan.goto(door.url);
    await expect(rescan.getByRole('heading', { name: '¡Ding, dong!' })).toBeVisible();
    const { visits } = await snapshot(database, FIXTURE_HOME);
    expect(visits).toHaveLength(1);
    await answerVisit(database, { homeId: FIXTURE_HOME, id: visits[0].id }, 'coming', 'Guido');
    for (const tab of [page, rescan]) await expect(tab.getByRole('heading', { name: '¡Ya van!' })).toBeVisible({ timeout: 15_000 });
    expect((await snapshot(database, FIXTURE_HOME)).visits).toHaveLength(1);
    expect(rings).toEqual([200]);
    // Ringing again starts over: the browser forgets the ring and a reload no longer brings it back.
    await page.getByRole('button', { name: 'Volver a tocar' }).click();
    await expect(page.getByRole('button', { name: 'Tocar timbre', exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Tocar timbre', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '¡Ya van!' })).toHaveCount(0);
  } finally { await door.close(); await postgres.close(); }
});

test('al volver sin respuesta la visita deja su nota, y pasada la ventana del timbrazo vuelve a ver el formulario', async ({ page, context }) => {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const door = await serveDoor(database);
  const rings = ringStatuses(context, door.token);
  try {
    await page.goto(door.url);
    await page.getByRole('button', { name: 'Tocar timbre', exact: true }).click();
    await expect(page.getByRole('heading', { name: '¡Ding, dong!' })).toBeVisible();
    const [visit] = (await snapshot(database, FIXTURE_HOME)).visits;
    await age(database, visit.id, DOORBELL.responseWindowSeconds + TIME.minuteSeconds);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Todavía no respondieron' })).toBeVisible();
    await page.getByLabel('Dejales un mensaje').fill('Vuelvo a las 18');
    await page.getByRole('button', { name: 'Dejar mensaje' }).click();
    await expect(page.getByText('Le dejamos tu mensaje.')).toBeVisible();
    expect((await snapshot(database, FIXTURE_HOME)).visits[0].note).toBe('Vuelvo a las 18');
    // Once its note window closes nothing more can happen to the ring, even if this browser still points to it.
    await age(database, visit.id, DOORBELL.noteWindowSeconds + TIME.minuteSeconds);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Tocar timbre', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Todavía no respondieron' })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    expect(rings).toEqual([200]);
  } finally { await door.close(); await postgres.close(); }
});

test('con la página abierta, cuando vence la ventana del timbrazo vuelve el formulario y el navegador lo olvida', async ({ page }) => {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const door = await serveDoor(database);
  try {
    await page.clock.install();
    await page.goto(door.url);
    await page.getByRole('button', { name: 'Tocar timbre', exact: true }).click();
    await expect(page.getByRole('heading', { name: '¡Ding, dong!' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.length)).toBe(1);
    await page.clock.runFor(DOORBELL.noteWindowSeconds * TIME.secondMs);
    await expect(page.getByRole('button', { name: 'Tocar timbre', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '¡Ding, dong!' })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
  } finally { await door.close(); await postgres.close(); }
});
