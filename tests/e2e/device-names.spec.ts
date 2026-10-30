import { test, expect } from '@playwright/test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { initialize } from '../../src/server/database';
import { snapshot } from '../../src/server/doorbell';
import { renameDevice, saveDevice } from '../../src/server/push';
import { AppError } from '../../src/server/errors';
import { bundleFixture } from './support/bundle-fixture';
import { FIXTURE_HOME, apiPath, dashboardInitial } from './support/dashboard-initial';
import { readText } from './support/read-text';
import { testDatabase } from '../support/test-database';
import { pushSubscription } from '../support/push-subscription';

// Real Dashboard, HTTP transport and PostgreSQL behind the same rename operation as `/api/rename-device`.
test('un nombre de celular que ya usa la casa se rechaza junto al campo y se corrige sin perder lo escrito', async ({ page }) => {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const owner = { id: 'devices-owner', email: 'guido@example.com', name: 'Guido', emailVerified: true };
  const settings = { bootstrapEmails: [owner.email] };
  await saveDevice(database, { homeId: FIXTURE_HOME, name: 'iPhone de Guido', subscription: pushSubscription('iphone') }, owner, settings);
  await saveDevice(database, { homeId: FIXTURE_HOME, name: 'Android', subscription: pushSubscription('android') }, owner, settings);
  const bundled = await bundleFixture('tests/fixtures/dashboard-entry.tsx', { development: true, stubAuthClient: true });
  const css = readFileSync('src/app/globals.css', 'utf8');
  async function answerApi(request: IncomingMessage, path: string) {
    if (path === 'dashboard') return snapshot(database, FIXTURE_HOME);
    if (path === 'device-status') return { active: false, deviceId: null };
    if (path === 'rename-device') {
      const input = JSON.parse(await readText(request)) as { home: number; id: string; name: string };
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
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Device names test server did not expose a port');
    await page.goto(`http://127.0.0.1:${address.port}/?home=${FIXTURE_HOME}&view=devices`);
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
    await nameField.fill('Android de Guido');
    await expect(fieldError).toHaveCount(0);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Nombre del celular actualizado.')).toBeVisible();
    await expect(page.locator('#devices .device-info strong')).toHaveText(['iPhone de Guido', 'Android de Guido']);
    expect((await snapshot(database, FIXTURE_HOME)).devices.map((device) => device.name)).toEqual(['iPhone de Guido', 'Android de Guido']);
  } finally { await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); await postgres.close(); }
});
