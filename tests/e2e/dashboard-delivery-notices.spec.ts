import { test, expect, type Page } from '@playwright/test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import nock from 'nock';
import { initialize } from '../../src/server/database';
import { getHome, ringAndNotify, snapshot } from '../../src/server/doorbell';
import { setHomeLocation, setNearbyOnly } from '../../src/server/location';
import { saveDevice } from '../../src/server/push';
import { addResident, renameResident } from '../../src/server/residents';
import { DOORBELL } from '../../src/constants/doorbell';
import { bundleFixture } from './support/bundle-fixture';
import { FIXTURE_HOME, apiPath, dashboardInitial } from './support/dashboard-initial';
import { testDatabase } from '../support/test-database';
import { PUSH_SERVICE, pushSubscription, withProvider } from '../support/push-subscription';

// Residents read the panel on their phones.
test.use({ viewport: { width: 390, height: 844 } });

/** The resident of this panel (as `dashboardInitial` signs them in) and the one whose phone stops ringing. */
const RESIDENT = { id: 'notices-resident', email: 'guido@example.com', name: 'Guido', emailVerified: true };
const ANA = { id: 'notices-ana', email: 'ana@example.com', name: 'Ana', emailVerified: true };
const SETTINGS = { bootstrapEmails: [RESIDENT.email] };
const DOOR = { latitude: -34.6037, longitude: -58.3816 };
const ACROSS_TOWN = { latitude: DOOR.latitude + 0.01, longitude: DOOR.longitude, accuracy: 15 };
const VAGUE_AT_THE_DOOR = { latitude: DOOR.latitude + 0.0002, longitude: DOOR.longitude, accuracy: 2_000 };

/** Real sidebar and Dashboard, HTTP transport and PostgreSQL behind `snapshot`; only the auth client and the Next router are stubbed. */
async function startPanel() {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const bundled = await bundleFixture('tests/fixtures/dashboard-shell-entry.tsx', { stubAuthClient: true });
  const css = readFileSync('src/app/globals.css', 'utf8');
  async function answer(request: IncomingMessage, response: ServerResponse) {
    const url = request.url || '/';
    if (url === '/bundle.js') { response.end(bundled); return; }
    if (url.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json');
      if (apiPath(url) !== 'dashboard') { response.statusCode = 404; response.end('{}'); return; }
      response.end(JSON.stringify(await snapshot(database, FIXTURE_HOME))); return;
    }
    if (url === '/sw.js') { response.statusCode = 404; response.end(''); return; }
    const initial = await dashboardInitial(database);
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><body><div id="root"></div><script>window.__INITIAL__=${JSON.stringify(initial)}</script><script src="/bundle.js"></script></body></html>`);
  }
  const server = createServer((request, response) => { void answer(request, response); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Delivery notices test server did not expose a TCP port');
  /** A visitor rings through the same operation as `POST /api/door/[token]`. */
  const ring = async (client: string, position: typeof ACROSS_TOWN | null = null) => {
    const { token } = await getHome(database, FIXTURE_HOME);
    return ringAndNotify(database, token, { id: crypto.randomUUID(), message: 'Soy del correo', client, position }).catch((error: unknown) => error);
  };
  return {
    url: (view: string) => `http://127.0.0.1:${address.port}/?home=${FIXTURE_HOME}&view=${view}`, database, ring,
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

test('Timbrazos dice cuántos timbrazos no sonaron hoy y por qué, y la próxima consulta lo actualiza', async ({ page }) => {
  const panel = await startPanel();
  try {
    await setHomeLocation(panel.database, FIXTURE_HOME, { ...DOOR, accuracy: 12 });
    await setNearbyOnly(panel.database, FIXTURE_HOME, true);
    await openWithoutNotifications(page, panel.url('history'));
    const history = page.locator('#history');
    // Nothing turned away yet: no line at all.
    await expect(history.getByRole('heading', { name: 'Por ahora, todo tranquilo' })).toBeVisible();
    await expect(history.getByText(/^Hoy no son/)).toHaveCount(0);

    await panel.ring('far-visitor', ACROSS_TOWN);
    await panel.ring('vague-visitor', VAGUE_AT_THE_DOOR);
    await checkNow(page);
    // Reasons with the same count keep a fixed order.
    const line = history.getByText('Hoy no sonaron 2 timbrazos: 1 con ubicación imprecisa y 1 desde lejos de la puerta.', { exact: true });
    await expect(line).toBeVisible();
    await expect(line).toBeInViewport();

    await panel.ring('another-far-visitor', ACROSS_TOWN);
    await checkNow(page);
    await expect(history.getByText('Hoy no sonaron 3 timbrazos: 2 desde lejos de la puerta y 1 con ubicación imprecisa.', { exact: true })).toBeVisible();
    await expect(line).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await panel.close(); }
});

test('Dispositivos avisa qué celular dio de baja su navegador, de quién era y desde cuándo, hasta que se vuelve a conectar', async ({ page }) => {
  const panel = await startPanel();
  try {
    await addResident(panel.database, RESIDENT, { homeId: FIXTURE_HOME, email: ANA.email }, SETTINGS);
    await renameResident(panel.database, RESIDENT, { homeId: FIXTURE_HOME, email: ANA.email, name: 'Ana' }, SETTINGS);
    await saveDevice(panel.database, { homeId: FIXTURE_HOME, name: 'iPhone de Ana', subscription: pushSubscription('expired-iphone') }, ANA, SETTINGS);
    // The next ring finds that Safari dropped the subscription: the provider answers 410.
    await withProvider(async () => {
      nock(PUSH_SERVICE).post('/expired-iphone').reply(410);
      await panel.ring('visitor');
    });
    const today = new Intl.DateTimeFormat('es-AR', { timeZone: DOORBELL.timeZone, day: '2-digit', month: '2-digit' }).format(new Date());
    await openWithoutNotifications(page, panel.url('devices'));
    const removed = page.getByRole('list', { name: 'Celulares que dejaron de recibir avisos' }).getByRole('listitem');
    await expect(removed).toHaveCount(1);
    await expect(removed).toContainText(`«iPhone de Ana» dejó de recibir avisos el ${today}: su navegador dio de baja la suscripción. Abrí Ringgg en ese celular para volver a conectarlo.`);
    await expect(removed).toContainText('De Ana · código 410');
    await expect(page.locator('#devices .device-row')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // Ana opens Ringgg on that phone and connects it again: the next check clears the notice.
    await saveDevice(panel.database, { homeId: FIXTURE_HOME, name: 'iPhone de Ana', subscription: pushSubscription('renewed-iphone') }, ANA, SETTINGS);
    await checkNow(page);
    await expect(page.locator('#devices .device-row').getByText('iPhone de Ana', { exact: true })).toBeVisible();
    await expect(removed).toHaveCount(0);
  } finally { await panel.close(); }
});
