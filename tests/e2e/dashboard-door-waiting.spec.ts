import { test, expect, type Page } from '@playwright/test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { initialize } from '../../src/server/database';
import { answerVisit, getHome, registerVisit, setDelivery, snapshot } from '../../src/server/doorbell';
import { AppError } from '../../src/server/errors';
import { bundleFixture } from './support/bundle-fixture';
import { FIXTURE_HOME, apiPath, dashboardInitial } from './support/dashboard-initial';
import { readText } from './support/read-text';
import { testDatabase } from '../support/test-database';

// The installed app opens on the overview: on a phone, a visit waiting for an answer has to show up there.
test.use({ viewport: { width: 390, height: 844 } });

/** The resident answering from this panel, as the answer route names them. */
const RESIDENT_NAME = 'Guido';

/**
 * Real sidebar and Dashboard, HTTP transport and PostgreSQL behind the same operations as the API routes;
 * only the auth client and the Next router are stubbed. `answers` counts the replies the panel sent.
 */
async function startPanel() {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const bundled = await bundleFixture('tests/fixtures/dashboard-shell-entry.tsx', { stubAuthClient: true });
  const css = readFileSync('src/app/globals.css', 'utf8');
  const counters = { answers: 0 };
  async function answerApi(request: IncomingMessage, path: string) {
    if (path === 'dashboard') return snapshot(database, FIXTURE_HOME);
    if (path === 'answer' && request.method === 'POST') {
      counters.answers += 1;
      const input = JSON.parse(await readText(request)) as { id: string; reply: 'coming' };
      return answerVisit(database, { homeId: FIXTURE_HOME, id: input.id }, input.reply, RESIDENT_NAME);
    }
    return null;
  }
  async function answer(request: IncomingMessage, response: ServerResponse) {
    const url = request.url || '/';
    if (url === '/bundle.js') { response.end(bundled); return; }
    if (url.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json');
      try {
        const result = await answerApi(request, apiPath(url));
        if (result === null) response.statusCode = 404;
        response.end(JSON.stringify(result ?? {}));
      } catch (error) { response.statusCode = error instanceof AppError ? error.status : 500; response.end(JSON.stringify({ error: error instanceof AppError ? error.message : 'No se pudo completar la prueba.' })); }
      return;
    }
    if (url === '/sw.js') { response.statusCode = 404; response.end(''); return; }
    const initial = await dashboardInitial(database);
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><body><div id="root"></div><script>window.__INITIAL__=${JSON.stringify(initial)}</script><script src="/bundle.js"></script></body></html>`);
  }
  const server = createServer((request, response) => { void answer(request, response); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Door waiting test server did not expose a TCP port');
  const ring = async (message: string) => {
    const id = crypto.randomUUID();
    await registerVisit(database, (await getHome(database, FIXTURE_HOME)).token, { id, message, client: `door-waiting-${id}` });
    await setDelivery(database, id, 'sent');
    return id;
  };
  return {
    url: `http://127.0.0.1:${address.port}/?home=${FIXTURE_HOME}`, database, counters, ring,
    close: async () => { await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); await postgres.close(); },
  };
}

/** A browser without notifications: the panel offers to activate them and the resident keeps going without. */
async function openWithoutNotifications(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Seguir sin avisos en este dispositivo' }).click();
}

/** The open panel checks right away when its window regains focus, instead of waiting for its cadence. */
async function checkNow(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

test('Resumen muestra la visita que espera y se responde desde ahí; «Timbrazos» la cuenta hasta que se atiende', async ({ page }) => {
  const panel = await startPanel();
  try {
    const id = await panel.ring('Soy del correo');
    await openWithoutNotifications(page, panel.url);
    const waiting = page.getByRole('region', { name: 'Hay alguien en la puerta' });
    await expect(waiting.getByRole('heading', { name: 'Soy del correo' })).toBeVisible();
    const coming = waiting.getByRole('button', { name: 'Ya voy', exact: true });
    // Opened from the icon, the reply is on the first screen: no navigation and no scrolling.
    await expect(coming).toBeInViewport();
    for (const label of ['En 5 minutos', 'Dejalo en la puerta', 'No estoy']) await expect(waiting.getByRole('button', { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Timbrazos, 1 por responder', exact: true })).toBeVisible();
    await expect(page.getByText('Alguien está en la puerta', { exact: true })).toBeVisible();

    await coming.dblclick();
    await expect(page.getByText('Tu visita ya ve: «¡Ya van!».', { exact: true })).toBeVisible();
    await expect(waiting).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Timbrazos', exact: true })).toBeVisible();
    await expect(page.getByText('Alguien está en la puerta')).toHaveCount(0);
    await expect(page).toHaveURL(panel.url);
    expect(panel.counters.answers).toBe(1);
    const [stored] = (await snapshot(panel.database, FIXTURE_HOME)).visits;
    expect(stored).toMatchObject({ id, reply: 'coming', answered_by: RESIDENT_NAME });
    expect(stored.answered_at).not.toBeNull();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // «Timbrazos» keeps the visit, answered.
    await page.getByRole('link', { name: 'Timbrazos', exact: true }).click();
    const row = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Soy del correo' }) });
    await expect(row.getByText('Atendido', { exact: true })).toBeVisible();
    await expect(row).toContainText(`${RESIDENT_NAME} · Va en camino · respondió en`);
  } finally { await panel.close(); }
});

test('si otro residente responde o vence la espera, Resumen deja de decir que hay alguien en la puerta', async ({ page }) => {
  const panel = await startPanel();
  try {
    const first = await panel.ring('Soy Juan');
    await page.clock.install();
    await openWithoutNotifications(page, panel.url);
    const waiting = page.getByRole('region', { name: 'Hay alguien en la puerta' });
    await expect(waiting.getByRole('heading', { name: 'Soy Juan' })).toBeVisible();

    // Another resident answers from their phone: the next check clears the block and the count.
    await answerVisit(panel.database, { homeId: FIXTURE_HOME, id: first }, 'away', 'Cami');
    await checkNow(page);
    await expect(waiting).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Timbrazos', exact: true })).toBeVisible();
    await expect(page.getByText('Alguien está en la puerta')).toHaveCount(0);
    await expect(page.getByText('Todo tranquilo', { exact: true })).toBeVisible();

    // A new ring shows up on the next check, and «Timbrazos» lists it once, without the overview block.
    await panel.ring('Traigo un paquete');
    await checkNow(page);
    await expect(waiting.getByRole('heading', { name: 'Traigo un paquete' })).toBeVisible();
    await page.getByRole('link', { name: 'Timbrazos, 1 por responder', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Ya voy', exact: true })).toHaveCount(1);
    await expect(waiting).toHaveCount(0);
    await page.getByRole('link', { name: 'Resumen', exact: true }).click();
    await expect(waiting.getByRole('heading', { name: 'Traigo un paquete' })).toBeVisible();

    // Past the two-minute answer window nobody can answer it anymore: the overview stops saying so.
    await page.clock.fastForward('02:10');
    await expect(waiting).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Timbrazos', exact: true })).toBeVisible();
    await expect(page.getByText('Alguien está en la puerta')).toHaveCount(0);
    expect(panel.counters.answers).toBe(0);
  } finally { await panel.close(); }
});
