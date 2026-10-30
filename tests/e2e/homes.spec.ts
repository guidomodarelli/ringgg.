import { test, expect } from '@playwright/test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { initialize } from '../../src/server/database';
import { snapshot } from '../../src/server/doorbell';
import { addResident, listResidentHomes, listResidents, renameResident } from '../../src/server/residents';
import { createHome } from '../../src/server/homes';
import { AppError } from '../../src/server/errors';
import { bundleFixture } from './support/bundle-fixture';
import { FIXTURE_HOME, apiPath, dashboardInitial } from './support/dashboard-initial';
import { readText } from './support/read-text';
import { testDatabase } from '../support/test-database';

// Real Dashboard, HTTP transport and PostgreSQL behind the same operations as the API routes;
// only the auth client and the Next router are stubbed (the stub records navigations).
test('la primera vez en una casa pide un nombre obligatorio y único, y desde el selector se agrega otra casa', async ({ page }) => {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const resident = { id: 'homes-resident', email: 'guido@example.com', name: 'Guido', emailVerified: true };
  const settings = { bootstrapEmails: [resident.email] };
  await addResident(database, resident, { homeId: FIXTURE_HOME, email: 'cami@example.com' }, settings);
  await renameResident(database, resident, { homeId: FIXTURE_HOME, email: 'cami@example.com', name: 'Cami' }, settings);
  const homeName = (await snapshot(database, FIXTURE_HOME)).home.name;
  const bundled = await bundleFixture('tests/fixtures/dashboard-entry.tsx', { development: true, stubAuthClient: true });
  const css = readFileSync('src/app/globals.css', 'utf8');
  const readJson = async (request: IncomingMessage) => JSON.parse(await readText(request) || '{}');
  let renames = 0;
  async function answerApi(request: IncomingMessage, path: string) {
    if (path === 'dashboard') return snapshot(database, FIXTURE_HOME);
    if (path === 'device-status') return { active: false, deviceId: null };
    if (path === 'residents') {
      const input = await readJson(request);
      if (input.home !== FIXTURE_HOME || input.action !== 'rename') throw new AppError(400, 'UNEXPECTED', 'Pedido inesperado.');
      renames += 1;
      await renameResident(database, resident, { homeId: FIXTURE_HOME, email: input.email, name: input.name }, settings);
      return { residents: await listResidents(database, FIXTURE_HOME, settings) };
    }
    if (path === 'homes') return createHome(database, resident, (await readJson(request)).name, settings);
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
    const initial = await dashboardInitial(database, {
      viewer: { name: null, suggestedName: 'Guido', email: resident.email },
      residents: await listResidents(database, FIXTURE_HOME, settings),
    });
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><style>${css}</style><body><div id="root"></div><script>window.__INITIAL__=${JSON.stringify(initial)}</script><script src="/bundle.js"></script></body></html>`);
  }
  const server = createServer((request, response) => { void answer(request, response); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const routerCalls = () => page.evaluate(() => (window as unknown as { __routerCalls: string[] }).__routerCalls);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Homes test server did not expose a port');
    await page.goto(`http://127.0.0.1:${address.port}/?home=${FIXTURE_HOME}`);

    // "¿Quién sos?" comes first, prefilled, and nothing but a name or signing out closes it.
    const nameDialog = page.getByRole('dialog', { name: '¿Quién sos?' });
    const nameField = nameDialog.getByLabel('Tu nombre');
    await expect(nameDialog).toBeVisible();
    await expect(nameField).toHaveValue('Guido');
    await expect(nameField).toBeFocused();
    await expect(page.getByRole('dialog', { name: 'Que no se te escape ninguna visita.' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(nameDialog).toBeVisible();
    await nameField.fill('   ');
    await expect(nameDialog.getByRole('button', { name: 'Guardar mi nombre' })).toBeDisabled();
    await nameField.fill('cámi');
    await nameDialog.getByRole('button', { name: 'Guardar mi nombre' }).click();
    await expect(nameDialog.getByRole('alert')).toHaveText('Ya hay alguien llamado «cámi» en esta casa. Elegí otro nombre.');
    await expect(nameField).toHaveValue('cámi');
    await nameField.fill('Guido');
    await expect(nameDialog.getByRole('alert')).toHaveCount(0);
    await nameDialog.getByRole('button', { name: 'Guardar mi nombre' }).dblclick();
    await expect(nameDialog).toHaveCount(0);
    await expect(page.getByText('Listo, Guido. Así te van a ver en esta casa.')).toBeVisible();
    expect((await listResidents(database, FIXTURE_HOME, settings)).map((entry) => entry.name)).toEqual(['Cami', 'Guido']);
    // The rejected name and one save for the double click.
    expect(renames).toBe(2);
    expect(await routerCalls()).toEqual(['refresh']);

    // Then notifications, for this home.
    const notifications = page.getByRole('dialog', { name: 'Que no se te escape ninguna visita.' });
    await expect(notifications).toContainText(`«${homeName}»`);
    await notifications.getByRole('button', { name: 'Seguir sin avisos en este dispositivo' }).click();

    // The switcher lists the resident's homes and creates another one with a name of its own.
    await page.locator('.home-switcher summary').click();
    const currentHome = page.getByRole('link', { name: homeName, exact: true });
    await expect(currentHome).toHaveAttribute('aria-current', 'page');
    await expect(currentHome).toHaveAttribute('href', `/?home=${FIXTURE_HOME}`);
    await page.getByRole('button', { name: 'Agregar casa' }).click();
    const newHome = page.getByLabel('Nombre de la nueva casa');
    await newHome.fill(homeName.toUpperCase());
    await page.getByRole('button', { name: 'Crear casa' }).click();
    await expect(page.getByRole('alert')).toHaveText(`Ya tenés una casa llamada «${homeName.toUpperCase()}». Elegí otro nombre.`);
    await newHome.fill('Casa de mamá');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Crear casa' }).click();
    await expect.poll(async () => (await listResidentHomes(database, resident, settings)).map((home) => home.name)).toEqual([homeName, 'Casa de mamá']);
    const [, created] = await listResidentHomes(database, resident, settings);
    await expect.poll(routerCalls).toEqual(['refresh', `push /?home=${created.id}`]);
  } finally { await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); await postgres.close(); }
});
