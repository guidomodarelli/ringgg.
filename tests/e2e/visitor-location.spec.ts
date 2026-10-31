import { test, expect, type Page } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { NEARBY_RINGING } from '../../src/constants/location';
import { initialize, type Database } from '../../src/server/database';
import { getHome, publicHome, readVisit, registerVisit, setDelivery, snapshot } from '../../src/server/doorbell';
import { requireNearby, setHomeLocation, setNearbyOnly } from '../../src/server/location';
import { FIXTURE_HOME } from './support/dashboard-initial';
import { readBody, serveFixture } from './support/visitor-fixture';
import { testDatabase } from '../support/test-database';

// Real React components, browser geolocation (set by Playwright), HTTP transport and PostgreSQL with the server's checks.

const DOOR = { latitude: -34.6037, longitude: -58.3816 };
/** About 45 m from the door, as precise as a phone outdoors. */
const AT_THE_DOOR = { latitude: DOOR.latitude + 0.0004, longitude: DOOR.longitude, accuracy: 20 };
/** A phone that only shares its approximate location: on the door, give or take two kilometers. */
const APPROXIMATE = { ...DOOR, accuracy: 2000 };
/** About 2 km away, with a precise reading. */
const ACROSS_TOWN = { latitude: DOOR.latitude + 0.02, longitude: DOOR.longitude, accuracy: 20 };

/**
 * A home that only rings from its door, and its visitor page. `rejectFirstAsImprecise` turns the first ring down
 * with the server's own verdict on an imprecise reading, like a server whose limit changed after the page loaded.
 */
async function serveNearbyDoor(database: Database, { rejectFirstAsImprecise = false } = {}) {
  await setHomeLocation(database, FIXTURE_HOME, { ...DOOR, accuracy: 10 });
  await setNearbyOnly(database, FIXTURE_HOME, true);
  const home = await getHome(database, FIXTURE_HOME);
  let rejectNext = rejectFirstAsImprecise;
  const fixture = await serveFixture('tests/fixtures/visitor-entry.tsx', `window.__VISITOR__=${JSON.stringify({ home: await publicHome(database, home.token), token: home.token })}`, async (request, response, path) => {
    if (path !== `door/${home.token}`) return false;
    if (request.method === 'GET') { response.end(JSON.stringify(await publicHome(database, home.token))); return true; }
    const input = await readBody(request);
    if (rejectNext) { rejectNext = false; requireNearby(home, { ...input.position, accuracy: NEARBY_RINGING.maxAccuracyMeters + 1 }); }
    const result = await registerVisit(database, home.token, { id: input.id, message: input.message, client: 'fixture-client', position: input.position });
    if (result.created) await setDelivery(database, input.id, 'unavailable');
    response.end(JSON.stringify(await readVisit(database, home.token, input.id))); return true;
  });
  return { ...fixture, token: home.token };
}

/** Rings that leave the browser for the server. */
function countRings(page: Page, token: string) {
  const rings = { sent: 0 };
  page.on('request', (request) => { if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/door/${token}`) rings.sent += 1; });
  return rings;
}

const GATE_NAME = 'Este timbre necesita tu ubicación.';

test('con una ubicación aproximada la visita ve cómo activar la precisa sin que se envíe el timbrazo, y con una precisa puede tocar', async ({ page, context }) => {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const door = await serveNearbyDoor(database);
  const rings = countRings(page, door.token);
  try {
    await context.setGeolocation(APPROXIMATE);
    await context.grantPermissions(['geolocation'], { origin: door.url });
    await page.goto(door.url);
    const gate = page.getByRole('dialog', { name: GATE_NAME });
    await expect(gate.getByRole('alert')).toContainText('ubicación aproximada');
    // This browser is neither an iPhone nor an Android phone, so the steps for both show.
    const iphone = gate.getByRole('listitem').filter({ hasText: 'iPhone:' });
    await expect(iphone).toContainText('Localización → Sitios web de Safari');
    await expect(iphone).toContainText('«Ubicación exacta»');
    await expect(gate.getByRole('listitem').filter({ hasText: 'Android:' })).toContainText('«Usar la ubicación precisa»');
    await page.keyboard.press('Escape');
    await expect(gate).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tocar timbre', exact: true })).toHaveCount(0);
    expect(rings.sent).toBe(0);
    // With the precise location on, a new reading at the door lets the visitor ring.
    await context.setGeolocation(AT_THE_DOOR);
    await gate.getByRole('button', { name: 'Volver a intentar' }).click();
    await expect(gate).toHaveCount(0);
    await page.getByRole('button', { name: 'Tocar timbre', exact: true }).click();
    await expect(page.getByRole('heading', { name: '¡Ding, dong!' })).toBeVisible();
    expect(rings.sent).toBe(1);
    expect((await snapshot(database, FIXTURE_HOME)).visits).toHaveLength(1);
  } finally { await door.close(); await postgres.close(); }
});

test('cada timbrazo lee la ubicación de nuevo: si al tocar es aproximada no se envía y la visita ve los pasos', async ({ page, context }) => {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const door = await serveNearbyDoor(database);
  const rings = countRings(page, door.token);
  try {
    await context.setGeolocation(AT_THE_DOOR);
    await context.grantPermissions(['geolocation'], { origin: door.url });
    await page.goto(door.url);
    const ringButton = page.getByRole('button', { name: 'Tocar timbre', exact: true });
    await expect(ringButton).toBeVisible();
    // The phone falls back to its approximate location after the page checked it: reusing that check would hide it.
    await context.setGeolocation(APPROXIMATE);
    await ringButton.click();
    const gate = page.getByRole('dialog', { name: GATE_NAME });
    await expect(gate.getByRole('alert')).toContainText('ubicación aproximada');
    expect(rings.sent).toBe(0);
    await context.setGeolocation(AT_THE_DOOR);
    await gate.getByRole('button', { name: 'Volver a intentar' }).click();
    await expect(gate).toHaveCount(0);
    await ringButton.click();
    await expect(page.getByRole('heading', { name: '¡Ding, dong!' })).toBeVisible();
    expect(rings.sent).toBe(1);
  } finally { await door.close(); await postgres.close(); }
});

test('si el servidor rechaza la lectura por imprecisa, la visita ve los pasos y no queda un error viejo al resolverlo', async ({ page, context }) => {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const door = await serveNearbyDoor(database, { rejectFirstAsImprecise: true });
  const rings = countRings(page, door.token);
  try {
    await context.setGeolocation(AT_THE_DOOR);
    await context.grantPermissions(['geolocation'], { origin: door.url });
    await page.goto(door.url);
    await page.getByRole('button', { name: 'Tocar timbre', exact: true }).click();
    const gate = page.getByRole('dialog', { name: GATE_NAME });
    await expect(gate.getByRole('alert')).toContainText('ubicación aproximada');
    await expect(gate.getByRole('listitem').filter({ hasText: 'Android:' })).toContainText('«Precisa»');
    await gate.getByRole('button', { name: 'Volver a intentar' }).click();
    await expect(gate).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Tocar timbre', exact: true }).click();
    await expect(page.getByRole('heading', { name: '¡Ding, dong!' })).toBeVisible();
    expect(rings.sent).toBe(2);
    expect((await snapshot(database, FIXTURE_HOME)).visits).toHaveLength(1);
  } finally { await door.close(); await postgres.close(); }
});

test('lejos de la puerta la visita ve que tiene que acercarse y, al acercarse, puede tocar', async ({ page, context }) => {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const door = await serveNearbyDoor(database);
  try {
    await context.setGeolocation(ACROSS_TOWN);
    await context.grantPermissions(['geolocation'], { origin: door.url });
    await page.goto(door.url);
    const ringButton = page.getByRole('button', { name: 'Tocar timbre', exact: true });
    await ringButton.click();
    await expect(page.getByRole('alert')).toContainText('Acercate para tocar el timbre');
    const help = page.getByText('en cada timbrazo medimos tu ubicación de nuevo', { exact: false });
    await expect(help).toBeVisible();
    expect((await snapshot(database, FIXTURE_HOME)).visits).toHaveLength(0);
    await context.setGeolocation(AT_THE_DOOR);
    await ringButton.click();
    await expect(page.getByRole('heading', { name: '¡Ding, dong!' })).toBeVisible();
    await expect(help).toHaveCount(0);
    expect((await snapshot(database, FIXTURE_HOME)).visits).toHaveLength(1);
  } finally { await door.close(); await postgres.close(); }
});
