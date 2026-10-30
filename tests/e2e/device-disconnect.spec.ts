import { test, expect, type Page } from '@playwright/test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { PushSubscription } from 'web-push';
import { DASHBOARD_POLLING } from '../../src/constants/polling';
import { initialize } from '../../src/server/database';
import { snapshot } from '../../src/server/doorbell';
import { AppError } from '../../src/server/errors';
import { findOwnDevice, removeDevice, saveDevice } from '../../src/server/push';
import { addResident, resolveHomeAccess } from '../../src/server/residents';
import { bundleFixture } from './support/bundle-fixture';
import { FIXTURE_HOME, apiPath, dashboardInitial } from './support/dashboard-initial';
import { readText } from './support/read-text';
import { testDatabase } from '../support/test-database';
import { pushSubscription } from '../support/push-subscription';

/** The resident signed in on this browser; the API routes read them from the session. */
const RESIDENT = { id: 'device-disconnect-resident', email: 'guido@example.com', name: 'Guido', emailVerified: true };
const SETTINGS = { bootstrapEmails: [RESIDENT.email] };
/** Another resident of the home, who manages its devices from their own panel. */
const OTHER_RESIDENT = { id: 'device-disconnect-other', email: 'cami@example.com', name: 'Cami', emailVerified: true };
/** The name this home gave the browser's device. */
const DEVICE_NAME = 'Compu de Guido';
/** Margin around each expected check: the page clock also moves with real time between steps. */
const MARGIN_MS = 3_000;

// Real Dashboard, HTTP transport and PostgreSQL behind the same device operations as the API routes;
// only the auth client, the Next router and the browser's push APIs are stubbed.
async function startDashboard(page: Page) {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const subscription = pushSubscription('this-browser');
  const { deviceId } = await saveDevice(database, { homeId: FIXTURE_HOME, name: DEVICE_NAME, subscription }, RESIDENT, SETTINGS);
  const bundled = await bundleFixture('tests/fixtures/dashboard-entry.tsx', { development: true, stubAuthClient: true });
  const css = readFileSync('src/app/globals.css', 'utf8');
  const polls: number[] = [];
  async function answerApi(request: IncomingMessage, path: string) {
    if (path === 'dashboard') { polls.push(Date.now()); return snapshot(database, FIXTURE_HOME); }
    // Never used: this browser already has a subscription, which activation reuses.
    if (path === 'push-key') return { publicKey: 'unused-public-key' };
    if (path === 'device-status') {
      const input = JSON.parse(await readText(request)) as { home: number; endpoint: string };
      return findOwnDevice(database, input.endpoint, await resolveHomeAccess(database, RESIDENT, input.home, SETTINGS));
    }
    if (path === 'remove-device') {
      const input = JSON.parse(await readText(request)) as { home: number; id: string };
      await removeDevice(database, input.home, input.id);
      return { ok: true };
    }
    if (path === 'subscribe') {
      const input = JSON.parse(await readText(request)) as { home: number; name: string; subscription: PushSubscription };
      return saveDevice(database, { homeId: input.home, name: input.name, subscription: input.subscription }, RESIDENT, SETTINGS);
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
    const initial = await dashboardInitial(database, { pushReady: true });
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><style>${css}</style><body><div id="root"></div><script>window.__INITIAL__=${JSON.stringify(initial)}</script><script src="/bundle.js"></script></body></html>`);
  }
  // Notifications are already allowed and the browser keeps the subscription it registered.
  await page.addInitScript((registered) => {
    Object.defineProperty(window, 'Notification', { value: { permission: 'granted', requestPermission: async () => 'granted' } });
    Object.defineProperty(window, 'PushManager', { value: function PushManager() {} });
    const browserSubscription = { endpoint: registered.endpoint, toJSON: () => registered };
    const registration = { pushManager: { getSubscription: async () => browserSubscription } };
    Object.defineProperty(navigator, 'serviceWorker', { value: { register: async () => registration, ready: Promise.resolve(registration), addEventListener() {}, removeEventListener() {} } });
  }, subscription);
  const server = createServer((request, response) => { void answer(request, response); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Device disconnect test server did not expose a port');
  return {
    url: `http://127.0.0.1:${address.port}/?home=${FIXTURE_HOME}&view=devices`, database, deviceId, polls,
    close: async () => { await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); await postgres.close(); },
  };
}

test('desconectar este dispositivo desde Dispositivos ofrece conectarlo otra vez sin recargar', async ({ page }) => {
  const dashboard = await startDashboard(page);
  try {
    await page.goto(dashboard.url);
    const thisDeviceBadge = page.getByText('Este dispositivo', { exact: true });
    const notice = page.getByText('Este dispositivo no recibe avisos de esta casa.');
    const connect = page.getByRole('button', { name: 'Conectar este dispositivo' });
    await expect(thisDeviceBadge).toBeVisible();
    await expect(notice).toHaveCount(0);
    await expect(page.locator('.setup-callout')).toHaveCount(0);
    // A reload would lose this mark.
    await page.evaluate(() => { (window as unknown as { __sameDocument: boolean }).__sameDocument = true; });
    await page.getByRole('button', { name: `Desconectar ${DEVICE_NAME}` }).click();
    await page.getByRole('button', { name: 'Sí', exact: true }).click();
    await expect(page.getByText('Dispositivo desconectado.')).toBeVisible();
    await expect(notice).toBeVisible();
    await expect(connect).toBeVisible();
    await expect(page.locator('.setup-callout')).toHaveCount(1);
    // The notice's button connects this browser to the home again.
    await connect.click();
    await expect(page.getByText('Dispositivo conectado. Enviá una prueba para comprobarlo.')).toBeVisible();
    await expect(thisDeviceBadge).toBeVisible();
    await expect(notice).toHaveCount(0);
    await expect(page.locator('.setup-callout')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
  } finally { await dashboard.close(); }
});

test('si otro residente desconecta este dispositivo, el panel lo muestra al actualizarse y vuelve a consultar cada 30 s', async ({ page }) => {
  const dashboard = await startDashboard(page);
  try {
    await page.clock.install();
    await page.goto(dashboard.url);
    await expect(page.getByText('Este dispositivo', { exact: true })).toBeVisible();
    const notice = page.getByText('Este dispositivo no recibe avisos de esta casa.');
    // Another resident disconnects it from their own panel; the first check, scheduled on load, brings the change.
    await removeDevice(dashboard.database, FIXTURE_HOME, dashboard.deviceId);
    await page.clock.runFor(DASHBOARD_POLLING.idleMs + MARGIN_MS);
    await expect(notice).toBeVisible();
    await expect(page.getByRole('button', { name: 'Conectar este dispositivo' })).toBeVisible();
    await expect(page.locator('.setup-callout')).toHaveCount(1);
    // That resident then connects their own phone: it rings for the home, but it is not this browser.
    await addResident(dashboard.database, RESIDENT, { homeId: FIXTURE_HOME, email: OTHER_RESIDENT.email }, SETTINGS);
    await saveDevice(dashboard.database, { homeId: FIXTURE_HOME, name: 'Android de Cami', subscription: pushSubscription('other-resident') }, OTHER_RESIDENT, SETTINGS);
    // The check scheduled while this browser was connected keeps its minute and brings that phone.
    await page.clock.runFor(DASHBOARD_POLLING.idleWithPushMs + MARGIN_MS);
    await expect(page.getByText('Android de Cami')).toBeVisible();
    await expect(notice).toBeVisible();
    // From then on, without notifications, the panel checks every 30 s again instead of once a minute.
    await page.clock.runFor(DASHBOARD_POLLING.idleMs + MARGIN_MS);
    await expect.poll(() => dashboard.polls.length).toBe(3);
  } finally { await dashboard.close(); }
});
