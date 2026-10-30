import { test, expect, type Page } from '@playwright/test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { initialize, type Database } from '../../src/server/database';
import { snapshot } from '../../src/server/doorbell';
import { findOwnDevice, renameDevice, saveDevice } from '../../src/server/push';
import { resolveHomeAccess } from '../../src/server/residents';
import { AppError } from '../../src/server/errors';
import { bundleFixture } from './support/bundle-fixture';
import { FIXTURE_HOME, apiPath, dashboardInitial } from './support/dashboard-initial';
import { readText } from './support/read-text';
import { testDatabase } from '../support/test-database';
import { pushSubscription } from '../support/push-subscription';

const OWNER = { id: 'devices-owner', email: 'guido@example.com', name: 'Guido', emailVerified: true };
const SETTINGS = { bootstrapEmails: [OWNER.email] };

interface DevicesFixture { database: Database; url: string; renames: string[]; close: () => Promise<void> }

/**
 * Real Dashboard, HTTP transport and PostgreSQL behind the same operations as `/api/device-status`
 * and `/api/rename-device`; only the auth client, the Next router and the browser's push APIs are stubbed.
 */
async function startDevicesFixture(prepare: (database: Database) => Promise<void>): Promise<DevicesFixture> {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  await saveDevice(database, { homeId: FIXTURE_HOME, name: 'iPhone de Guido', subscription: pushSubscription('iphone') }, OWNER, SETTINGS);
  await saveDevice(database, { homeId: FIXTURE_HOME, name: 'Android', subscription: pushSubscription('android') }, OWNER, SETTINGS);
  await prepare(database);
  const bundled = await bundleFixture('tests/fixtures/dashboard-entry.tsx', { development: true, stubAuthClient: true });
  const css = readFileSync('src/app/globals.css', 'utf8');
  const renames: string[] = [];
  async function answerApi(request: IncomingMessage, path: string) {
    if (path === 'dashboard') return snapshot(database, FIXTURE_HOME);
    if (path === 'device-status') {
      const input = JSON.parse(await readText(request)) as { home: number; endpoint: string };
      return findOwnDevice(database, input.endpoint, await resolveHomeAccess(database, OWNER, input.home, SETTINGS));
    }
    if (path === 'rename-device') {
      const input = JSON.parse(await readText(request)) as { home: number; id: string; name: string };
      renames.push(input.name);
      await renameDevice(database, input.home, input.id, input.name);
      return snapshot(database, input.home);
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
    response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><style>${css}</style><body><div id="root"></div><script>window.__INITIAL__=${JSON.stringify(initial)}</script><script src="/bundle.js"></script></body></html>`);
  }
  const server = createServer((request, response) => { void answer(request, response); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Device names test server did not expose a port');
  return {
    database, renames, url: `http://127.0.0.1:${address.port}/?home=${FIXTURE_HOME}&view=devices`,
    close: async () => { await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); await postgres.close(); },
  };
}

/** This browser already rings for the home: notifications granted and its subscription registered. */
async function connectThisBrowser(page: Page, endpoint: string) {
  await page.addInitScript((subscriptionEndpoint) => {
    Object.defineProperty(window, 'Notification', { value: { permission: 'granted', requestPermission: async () => 'granted' } });
    Object.defineProperty(window, 'PushManager', { value: function PushManager() {} });
    const registration = { pushManager: { getSubscription: async () => ({ endpoint: subscriptionEndpoint }) } };
    Object.defineProperty(navigator, 'serviceWorker', { value: { register: async () => registration, ready: Promise.resolve(registration), addEventListener() {}, removeEventListener() {} } });
  }, endpoint);
}

const homeDeviceNames = async (database: Database) => (await snapshot(database, FIXTURE_HOME)).devices.map((device) => device.name);

test('un nombre de celular que ya usa la casa se rechaza junto al campo y se corrige sin perder lo escrito', async ({ page }) => {
  const fixture = await startDevicesFixture(async () => undefined);
  try {
    await page.goto(fixture.url);
    await page.getByRole('button', { name: 'Seguir sin avisos en este dispositivo' }).click();
    await page.getByRole('button', { name: 'Renombrar Android' }).click();
    const nameField = page.getByLabel('Nombre del celular');
    await nameField.fill('iphone de guído');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    const fieldError = page.locator('#devices').getByRole('alert');
    await expect(fieldError).toHaveText('Ya hay un celular llamado «iphone de guído» en esta casa. Elegí otro nombre.');
    await expect(nameField).toHaveAttribute('aria-invalid', 'true');
    await expect(nameField).toHaveValue('iphone de guído');
    // The error lives next to the field only, not again at the top of the page.
    await expect(page.locator('.feedback.error')).toHaveCount(0);
    // A generic name is rejected the same way, before any request.
    await nameField.fill('Mi celular');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(fieldError).toContainText('Elegí un nombre que lo distinga');
    await nameField.fill('Android de Guido');
    await expect(fieldError).toHaveCount(0);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Nombre del celular actualizado.')).toBeVisible();
    await expect(page.locator('#devices .device-info strong')).toHaveText(['iPhone de Guido', 'Android de Guido']);
    expect(await homeDeviceNames(fixture.database)).toEqual(['iPhone de Guido', 'Android de Guido']);
    // Known problems never reached the server: only the valid name did.
    expect(fixture.renames).toEqual(['Android de Guido']);
  } finally { await fixture.close(); }
});

test('un celular conectado como «Mi celular» tiene que tomar un nombre propio antes de seguir', async ({ page }) => {
  const thisBrowser = pushSubscription('legacy-phone');
  const fixture = await startDevicesFixture(async (database) => {
    // Connected before devices were named: its name in the home is the old generic one.
    const { deviceId } = await saveDevice(database, { homeId: FIXTURE_HOME, name: 'Celu viejo', subscription: thisBrowser }, OWNER, SETTINGS);
    await database.query(`UPDATE device_homes SET name = 'Mi celular', name_key = 'mi celular' WHERE device_id = $1`, [deviceId]);
  });
  try {
    await connectThisBrowser(page, thisBrowser.endpoint);
    await page.goto(fixture.url);
    const dialog = page.getByRole('dialog', { name: '¿Cómo se llama este dispositivo?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('figura como «Mi celular»');
    const field = dialog.getByLabel('Nombre de este dispositivo');
    await expect(field).toHaveValue(/ de Guido$/);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    const save = dialog.getByRole('button', { name: 'Guardar nombre' });
    await field.fill('Celular 2');
    await save.click();
    await expect(dialog.getByRole('alert')).toContainText('Elegí un nombre que lo distinga');
    await field.fill('iphone de GUIDO');
    await save.click();
    await expect(dialog.getByRole('alert')).toHaveText('Ya hay un celular llamado «iphone de GUIDO» en esta casa. Elegí otro nombre.');
    await field.fill('');
    await expect(save).toBeDisabled();
    await field.fill('Compu del living');
    await save.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Listo: este dispositivo ahora se llama «Compu del living».')).toBeVisible();
    await expect(page.locator('#devices .device-info strong').filter({ hasText: 'Compu del living' })).toContainText('Este dispositivo');
    expect(await homeDeviceNames(fixture.database)).toEqual(['iPhone de Guido', 'Android', 'Compu del living']);
    expect(fixture.renames).toEqual(['Compu del living']);
  } finally { await fixture.close(); }
});
