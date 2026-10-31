import { test, expect, type Page } from '@playwright/test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { initialize } from '../../src/server/database';
import { getHome, registerVisit, snapshot } from '../../src/server/doorbell';
import { DASHBOARD_POLLING } from '../../src/constants/polling';
import { ERROR_CODES } from '../../src/constants/error-codes';
import { bundleFixture } from './support/bundle-fixture';
import { FIXTURE_HOME, apiPath, dashboardInitial } from './support/dashboard-initial';
import { testDatabase } from '../support/test-database';

/** What every resident route answers once the session is gone, as `requireIdentity` does. */
const SESSION_CLOSED = { error: 'Ingresá de nuevo para continuar.', code: ERROR_CODES.authRequired };

interface DashboardServerOptions {
  failNextPolls?: () => boolean;
  /** While it returns `true`, every API request answers 401 with {@link SESSION_CLOSED}. */
  signedOut?: () => boolean;
}

// Real Dashboard, HTTP transport and PostgreSQL; only the auth client and the Next router are stubbed.
async function startDashboard(options: DashboardServerOptions = {}) {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const bundled = await bundleFixture('tests/fixtures/dashboard-entry.tsx', { development: true, stubAuthClient: true });
  const css = readFileSync('src/app/globals.css', 'utf8');
  const polls: number[] = [];
  async function answer(request: IncomingMessage, response: ServerResponse) {
    const url = request.url || '/';
    if (url === '/bundle.js') { response.end(bundled); return; }
    if (url.startsWith('/api/') && apiPath(url) === 'dashboard') polls.push(Date.now());
    if (url.startsWith('/api/') && options.signedOut?.()) { response.statusCode = 401; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(SESSION_CLOSED)); return; }
    if (url.startsWith('/api/') && apiPath(url) === 'dashboard') {
      response.setHeader('Content-Type', 'application/json');
      if (options.failNextPolls?.()) { response.statusCode = 503; response.end(JSON.stringify({ error: 'No pudimos actualizar el panel.' })); return; }
      response.end(JSON.stringify(await snapshot(database, FIXTURE_HOME))); return;
    }
    if (url.startsWith('/api/') || url === '/sw.js') { response.statusCode = 404; response.end('{}'); return; }
    const initial = await dashboardInitial(database);
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><style>${css}</style><body><div id="root"></div><script>window.__INITIAL__=${JSON.stringify(initial)}</script><script src="/bundle.js"></script></body></html>`);
  }
  const server = createServer((request, response) => { void answer(request, response); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Dashboard polling test server did not expose a port');
  return {
    url: `http://127.0.0.1:${address.port}`, database, polls,
    close: async () => { await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); await postgres.close(); },
  };
}

/** A browser without notifications: the panel offers to activate them and the resident keeps going without. */
async function openWithoutNotifications(page: Page, url: string) {
  await page.clock.install();
  await page.goto(url);
  await page.getByRole('button', { name: 'Seguir sin avisos en este dispositivo' }).click();
}

/** Margin around each expected check: the page clock also moves with real time between steps. */
const MARGIN_MS = 3_000;

/**
 * Each check schedules the next one only after its response arrives, so the clock advances in steps:
 * nothing may happen shortly before the expected delay, and exactly one check right after it.
 */
async function expectNextCheckAfter(page: Page, polls: number[], delayMs: number) {
  const before = polls.length;
  await page.clock.runFor(delayMs - MARGIN_MS);
  expect(polls, `no check before ${delayMs} ms`).toHaveLength(before);
  await page.clock.runFor(2 * MARGIN_MS);
  await expect.poll(() => polls.length).toBe(before + 1);
}

test('sin notificaciones el panel inactivo consulta cada 30 s, no cada 5 s', async ({ page }) => {
  const dashboard = await startDashboard();
  try {
    await openWithoutNotifications(page, dashboard.url);
    await expectNextCheckAfter(page, dashboard.polls, DASHBOARD_POLLING.idleMs);
    await expectNextCheckAfter(page, dashboard.polls, DASHBOARD_POLLING.idleMs);
    expect(dashboard.polls).toHaveLength(2);
  } finally { await dashboard.close(); }
});

test('mientras una visita se puede responder el panel consulta cada 5 s y después vuelve a la cadencia lenta', async ({ page }) => {
  const dashboard = await startDashboard();
  try {
    await registerVisit(dashboard.database, (await getHome(dashboard.database, FIXTURE_HOME)).token, { id: crypto.randomUUID(), message: 'Soy del delivery', client: 'polling-client' });
    await openWithoutNotifications(page, dashboard.url);
    for (let check = 1; check <= 3; check += 1) {
      await page.clock.runFor(DASHBOARD_POLLING.answeringMs + 500);
      await expect.poll(() => dashboard.polls.length).toBe(check);
    }
    // Past the two-minute answer window the cadence slows down again.
    await page.clock.runFor(120_000);
    await expect.poll(() => dashboard.polls.length).toBe(4);
    await expectNextCheckAfter(page, dashboard.polls, DASHBOARD_POLLING.idleMs);
  } finally { await dashboard.close(); }
});

test('una actualización fallida avisa sin bloquear y el aviso se borra solo al recuperarse', async ({ page }) => {
  let failures = 1;
  const dashboard = await startDashboard({ failNextPolls: () => failures-- > 0 });
  try {
    await openWithoutNotifications(page, dashboard.url);
    await page.clock.runFor(DASHBOARD_POLLING.idleMs + 500);
    const notice = page.getByText('No pudimos actualizar el panel. Seguimos intentando solos.');
    await expect(notice).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Reintentar ahora' }).click();
    await expect(notice).toHaveCount(0);
  } finally { await dashboard.close(); }
});

const SESSION_NOTICE = 'Tu sesión se cerró y el panel dejó de actualizarse.';

test('con la sesión vencida el aviso ofrece ingresar de nuevo y no reintentar', async ({ page }) => {
  const dashboard = await startDashboard({ signedOut: () => true });
  try {
    await openWithoutNotifications(page, dashboard.url);
    await page.clock.runFor(DASHBOARD_POLLING.idleMs + 500);
    await expect(page.getByText(SESSION_NOTICE)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reintentar ahora' })).toHaveCount(0);
    await expect(page.getByText('Seguimos intentando solos', { exact: false })).toHaveCount(0);
    // The panel's own address: without a session the server sends it to sign in, and then back to this home.
    await page.getByRole('link', { name: 'Ingresar de nuevo' }).click();
    await expect(page).toHaveURL(`${dashboard.url}/?home=${FIXTURE_HOME}`);
  } finally { await dashboard.close(); }
});

test('una acción que encuentra la sesión cerrada muestra ese aviso sin repetir el error, y se va al volver a ingresar', async ({ page }) => {
  let signedOut = true;
  const dashboard = await startDashboard({ signedOut: () => signedOut });
  try {
    await openWithoutNotifications(page, `${dashboard.url}/?home=${FIXTURE_HOME}&view=settings`);
    await page.getByLabel('Nombre de tu casa').fill('Casa nueva');
    await page.getByRole('button', { name: 'Guardar nombre' }).click();
    const notice = page.getByText(SESSION_NOTICE);
    await expect(notice).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ingresar de nuevo' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    // The action found it, not a check: the first one is still 30 s away.
    expect(dashboard.polls).toHaveLength(0);
    // Signing in again elsewhere (another tab): the next check succeeds and no old error comes back.
    signedOut = false;
    await page.clock.runFor(DASHBOARD_POLLING.idleMs + 500);
    await expect(notice).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Guardar nombre' })).toBeEnabled();
  } finally { await dashboard.close(); }
});
