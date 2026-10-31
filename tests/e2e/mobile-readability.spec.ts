import { test, expect, type Locator } from '@playwright/test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { initialize } from '../../src/server/database';
import { answerVisit, getHome, publicHome, readVisit, registerVisit, snapshot } from '../../src/server/doorbell';
import { saveDevice } from '../../src/server/push';
import { AppError } from '../../src/server/errors';
import { VISITOR_POLLING } from '../../src/constants/polling';
import { bundleFixture } from './support/bundle-fixture';
import { FIXTURE_HOME, apiPath, dashboardInitial } from './support/dashboard-initial';
import { readText } from './support/read-text';
import { testDatabase } from '../support/test-database';
import { pushSubscription } from '../support/push-subscription';

/** A small phone: every check below is about what changes at or under 700 px. */
const PHONE_VIEWPORT = { width: 375, height: 812 };
/** A touch tablet, wider than the phone layout. */
const TOUCH_TABLET_VIEWPORT = { width: 1024, height: 768 };
/** iOS Safari zooms the page into a focused field whose text is smaller than this. */
const NO_ZOOM_FIELD_FONT_PX = 16;
/** WCAG 1.4.3: contrast of normal-size text, such as a button label, with its background. */
const TEXT_CONTRAST_MINIMUM = 4.5;
/** WCAG 1.4.11: contrast of a focus indicator with what surrounds it. */
const NON_TEXT_CONTRAST_MINIMUM = 3;
/** «Tocar timbre» keeps on a phone the size it has on a computer. */
const RING_BUTTON_MINIMUM = { fontPx: 14, heightPx: 54 };
const WHITE = 'rgb(255, 255, 255)';
const OWNER = { id: 'readability-owner', email: 'guido@example.com', name: 'Guido', emailVerified: true };
const SETTINGS = { bootstrapEmails: [OWNER.email] };

test.use({ viewport: PHONE_VIEWPORT });

/** WCAG 2.x relative luminance of a computed, opaque `rgb()` color. */
function luminance(color: string) {
  const match = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(color);
  if (!match) throw new Error(`luminance: expected a computed rgb() color, got «${color}»`);
  // A translucent color's contrast depends on what lies under it, which these checks do not read.
  expect(Number(match[4] ?? 1), `${color} has to be opaque to measure its contrast`).toBe(1);
  const [red, green, blue] = match.slice(1, 4).map((channel) => {
    const value = Number(channel) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG contrast ratio between two computed colors, from 1 to 21. */
function contrast(first: string, second: string) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((one, other) => other - one);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Exactly `count` fields are visible in `scope`, and none of them makes iOS zoom when it gets focus. */
async function expectFieldsWithoutZoom(scope: Locator, count: number) {
  const fields = await scope.locator('input:visible, textarea:visible, select:visible').evaluateAll((elements) => elements.map((element) => ({
    field: element.getAttribute('name') || element.id || element.tagName.toLowerCase(),
    fontPx: Number.parseFloat(getComputedStyle(element).fontSize),
  })));
  expect(fields).toHaveLength(count);
  expect(fields.filter((field) => field.fontPx < NO_ZOOM_FIELD_FONT_PX)).toEqual([]);
}

/** White label on the primary background, as the browser computes both. */
async function expectReadablePrimary(button: Locator) {
  await expect(button).toHaveClass(/\bprimary\b/);
  const colors = await button.evaluate((element) => ({ text: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
  expect(contrast(colors.text, colors.background), `${colors.text} on ${colors.background}`).toBeGreaterThanOrEqual(TEXT_CONTRAST_MINIMUM);
}

/** The focused element shows its ring, and the ring reads on the page (--paper), on white and on the dialog that holds it. */
async function expectReadableFocusRing(element: Locator) {
  const ring = await element.evaluate((focused) => {
    const style = getComputedStyle(focused);
    const dialog = focused.closest('dialog');
    return {
      focusVisible: focused.matches(':focus-visible'), outline: style.outlineStyle, color: style.outlineColor,
      surfaces: [getComputedStyle(document.body).backgroundColor, ...(dialog ? [getComputedStyle(dialog).backgroundColor] : [])],
    };
  });
  expect(ring).toMatchObject({ focusVisible: true, outline: 'solid' });
  for (const surface of [...ring.surfaces, WHITE]) expect(contrast(ring.color, surface), `${ring.color} ring on ${surface}`).toBeGreaterThanOrEqual(NON_TEXT_CONTRAST_MINIMUM);
}

/** The page does not scroll sideways, and every visible field and button fits the screen. */
async function expectFitsScreenWidth(scope: Locator) {
  const layout = await scope.evaluate((root) => {
    const width = document.documentElement.clientWidth;
    const outside = [...root.querySelectorAll('input, textarea, select, button')].filter((element) => element.checkVisibility())
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.left < 0 || box.right > width + 0.5)
      .map(({ element, box }) => `${element.id || element.textContent.trim() || element.tagName.toLowerCase()} (${Math.round(box.left)} to ${Math.round(box.right)} px)`);
    return { scrollsSideways: document.documentElement.scrollWidth > width, outside };
  });
  expect(layout).toEqual({ scrollsSideways: false, outside: [] });
}

interface Fixture { url: string; close: () => Promise<void> }

/**
 * Serves a component fixture with the app's real stylesheet and the root layout's viewport tag.
 * `answerApi` returns the JSON body of an `/api/*` request, or `null` for a 404.
 */
async function serveFixture(entry: string, inject: string, answerApi: (request: IncomingMessage, path: string) => Promise<unknown>, stubAuthClient = false): Promise<Fixture> {
  const bundled = await bundleFixture(entry, { stubAuthClient });
  const css = readFileSync('src/app/globals.css', 'utf8');
  async function answer(request: IncomingMessage, response: ServerResponse) {
    const url = request.url || '/';
    if (url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled); return; }
    if (url === '/sw.js') { response.statusCode = 404; response.end(''); return; }
    if (url.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json');
      try {
        const body = await answerApi(request, apiPath(url));
        if (body === null) response.statusCode = 404;
        response.end(JSON.stringify(body ?? {}));
      } catch (error) { response.statusCode = error instanceof AppError ? error.status : 500; response.end(JSON.stringify({ error: error instanceof AppError ? error.message : 'No se pudo completar la prueba.' })); }
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><div id="root"></div><script>${inject}</script><script src="/bundle.js"></script></body></html>`);
  }
  const server = createServer((request, response) => { void answer(request, response); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error(`serveFixture: the server for ${entry} did not expose a TCP port`);
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

test('en el celular «Tocar timbre» conserva su tamaño, los botones primarios y el foco se leen y los campos de la visita no hacen zoom', async ({ page }) => {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const { token } = await getHome(database, FIXTURE_HOME);
  const fixture = await serveFixture('tests/fixtures/visitor-entry.tsx', `window.__VISITOR__=${JSON.stringify({ home: await publicHome(database, token), token })}`, async (request, path) => {
    const [, doorToken, , visitId] = path.split('/');
    if (request.method === 'POST' && !visitId) {
      const input = JSON.parse(await readText(request)) as { id: string; message: string };
      await registerVisit(database, doorToken, { id: input.id, message: input.message, client: 'readability-client' });
      return readVisit(database, doorToken, input.id);
    }
    if (request.method === 'GET' && visitId) return readVisit(database, doorToken, visitId);
    return null;
  });
  try {
    await page.clock.install();
    await page.goto(fixture.url);
    const main = page.getByRole('main');
    const ring = page.getByRole('button', { name: 'Tocar timbre', exact: true });
    await expect(ring).toBeVisible();
    // The phone `.button` rule used to shrink it to 12 px and 44 px.
    const ringFontPx = await ring.evaluate((button) => Number.parseFloat(getComputedStyle(button).fontSize));
    expect(ringFontPx).toBeGreaterThanOrEqual(RING_BUTTON_MINIMUM.fontPx);
    expect((await ring.boundingBox())?.height).toBeGreaterThanOrEqual(RING_BUTTON_MINIMUM.heightPx);
    await expectReadablePrimary(ring);
    await expectFieldsWithoutZoom(main, 1);
    await page.getByLabel('¿Querés decir quién sos?').fill('Soy Juan');
    await page.keyboard.press('Tab');
    await expect(ring).toBeFocused();
    await expectReadableFocusRing(ring);
    await ring.click();
    await expect(page.getByRole('heading', { name: '¡Ding, dong!' })).toBeVisible();
    // The residents are away: the visitor gets the note form, with its own field and primary button.
    const [visit] = (await snapshot(database, FIXTURE_HOME)).visits;
    await answerVisit(database, { homeId: FIXTURE_HOME, id: visit.id }, 'away', 'Guido');
    await page.clock.fastForward(VISITOR_POLLING.answerMs);
    await expect(page.getByRole('heading', { name: 'No están en casa' })).toBeVisible();
    await page.getByLabel('Dejales un mensaje').fill('Vuelvo mañana a las 10');
    await expectFieldsWithoutZoom(main, 1);
    await expectReadablePrimary(page.getByRole('button', { name: 'Dejar mensaje' }));
    await expectFitsScreenWidth(main);
  } finally { await fixture.close(); await postgres.close(); }
});

test('en una tablet táctil, más ancha que el diseño de celular, los campos tampoco hacen zoom', async ({ browser }) => {
  const home = { name: 'Casa de prueba', paused: false, pausedUntil: null, quiet: false, quietUntil: null, nearbyOnly: false };
  const fixture = await serveFixture('tests/fixtures/visitor-entry.tsx', `window.__VISITOR__=${JSON.stringify({ home, token: 'token' })}`, async () => null);
  const context = await browser.newContext({ viewport: TOUCH_TABLET_VIEWPORT, hasTouch: true, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await page.goto(fixture.url);
    await expect(page.getByLabel('¿Querés decir quién sos?')).toBeVisible();
    await expectFieldsWithoutZoom(page.getByRole('main'), 1);
  } finally { await context.close(); await fixture.close(); }
});

test('en /sign-in ningún campo de ingreso, registro, recuperación ni verificación hace zoom', async ({ page }) => {
  await page.goto('/sign-in');
  const form = page.locator('form.login-form');
  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  await expectFieldsWithoutZoom(form, 2);
  // Through Next's own CSS pipeline too, the primary button reaches the contrast it needs.
  await expectReadablePrimary(page.getByRole('button', { name: 'Entrar a mi casa' }));
  await page.getByRole('button', { name: 'Crear una cuenta' }).click();
  await expect(page.getByLabel('Tu nombre')).toBeVisible();
  await expectFieldsWithoutZoom(form, 3);
  await page.getByRole('button', { name: 'Volver a ingresar' }).click();
  await page.getByRole('button', { name: 'Olvidé mi contraseña' }).click();
  await expect(page.getByRole('button', { name: 'Enviar enlace' })).toBeVisible();
  await expectFieldsWithoutZoom(form, 1);
  await page.getByRole('button', { name: 'Volver a ingresar' }).click();
  await page.getByRole('button', { name: 'Verificar mi correo' }).click();
  await expect(page.getByLabel('Código de verificación')).toBeVisible();
  await expectFieldsWithoutZoom(form, 2);
  await expectFitsScreenWidth(page.locator('body'));
});

test('en el celular la activación y los formularios de dispositivos, ajustes y residentes no hacen zoom ni se salen de la pantalla', async ({ page }) => {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  await saveDevice(database, { homeId: FIXTURE_HOME, name: 'Android', subscription: pushSubscription('android') }, OWNER, SETTINGS);
  const initial = await dashboardInitial(database);
  const fixture = await serveFixture('tests/fixtures/dashboard-entry.tsx', `window.__INITIAL__=${JSON.stringify(initial)}`, async (_request, path) => path === 'dashboard' ? snapshot(database, FIXTURE_HOME) : null, true);
  const panel = (view: string) => `${fixture.url}/?home=${FIXTURE_HOME}&view=${view}`;
  try {
    // Headless Chromium reports «denied» even after `grantPermissions`, which hides the naming form: only
    // this getter stands in for a phone that has not answered the permission prompt yet.
    await page.addInitScript(() => { Object.defineProperty(Notification, 'permission', { get: () => 'default' }); });
    await page.goto(panel('devices'));
    const activation = page.getByRole('dialog', { name: 'Que no se te escape ninguna visita.' });
    const activationName = activation.getByLabel('Nombre de este dispositivo');
    await expect(activationName).toBeFocused();
    await expectFieldsWithoutZoom(activation, 1);
    await expectReadableFocusRing(activationName);
    await expectReadablePrimary(activation.getByRole('button', { name: 'Activar notificaciones' }));
    await activation.getByRole('button', { name: 'Seguir sin avisos en este dispositivo' }).click();
    const devices = page.locator('#devices');
    await expect(devices.getByLabel('Nombre de este dispositivo')).toBeVisible();
    await devices.getByRole('button', { name: 'Renombrar Android' }).click();
    await expect(devices.getByLabel('Nombre del celular')).toBeVisible();
    await expectFieldsWithoutZoom(devices, 2);
    await expectFitsScreenWidth(devices);
    await page.goto(panel('settings'));
    const settings = page.locator('#settings');
    await settings.getByRole('button', { name: 'Configurar horario' }).click();
    await expect(settings.getByLabel('Desde')).toBeVisible();
    await expectFieldsWithoutZoom(settings, 3);
    await expectFitsScreenWidth(settings);
    await page.goto(panel('residents'));
    const residents = page.locator('#residents');
    await expect(residents.getByLabel('Correo del nuevo residente')).toBeVisible();
    await expectFieldsWithoutZoom(residents, 1);
    await expectFitsScreenWidth(residents);
  } finally { await fixture.close(); await postgres.close(); }
});
