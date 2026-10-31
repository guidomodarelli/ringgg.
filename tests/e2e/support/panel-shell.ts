import { expect, type Locator, type Page } from '@playwright/test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { initialize } from '../../../src/server/database';
import { snapshot } from '../../../src/server/doorbell';
import { testDatabase } from '../../support/test-database';
import { bundleFixture } from './bundle-fixture';
import { FIXTURE_HOME, apiPath, dashboardInitial } from './dashboard-initial';

/** Insets in CSS pixels, as `env(safe-area-inset-*)` reports them on an iPhone. */
export interface SafeAreaInsets { right: number; bottom: number; left: number }

export const NO_INSETS: SafeAreaInsets = { right: 0, bottom: 0, left: 0 };
/** Height of the mobile bottom bar without the home indicator, the `--bottom-nav-height` token. */
export const BOTTOM_NAV_HEIGHT_PX = 65;
/** Width of the side rail before the left inset: icons only up to 900 px, with labels up to 1100 px. */
export const SIDE_RAIL_WIDTH_PX = { iconsOnly: 75, labeled: 205 };
/**
 * Where the page ends depends on fractional text heights (DPR 3, the fallback font when Google Fonts does
 * not load), so scrolled boxes may overshoot a fraction of a pixel; a missing inset moves them 20 px or more.
 */
export const SUBPIXEL_TOLERANCE_PX = 1;

/**
 * The real shell (side bar, topbar, Dashboard) with the app stylesheet; only the auth client and the
 * Next router are stubbed. It declares the viewport of the root layout, whose `viewportFit: 'cover'`
 * lets the page reach the screen edges.
 */
export async function startPanelShell() {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const bundled = await bundleFixture('tests/fixtures/app-shell-entry.tsx', { stubAuthClient: true });
  const css = readFileSync('src/app/globals.css', 'utf8');
  async function answer(request: IncomingMessage, response: ServerResponse) {
    const url = request.url || '/';
    if (url === '/bundle.js') { response.end(bundled); return; }
    if (url.startsWith('/api/') && apiPath(url) === 'dashboard') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(await snapshot(database, FIXTURE_HOME))); return; }
    if (url.startsWith('/api/') || url === '/sw.js') { response.statusCode = 404; response.end('{}'); return; }
    const initial = await dashboardInitial(database);
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${css}</style><body><div id="root"></div><script>window.__INITIAL__=${JSON.stringify(initial)}</script><script src="/bundle.js"></script></body></html>`);
  }
  const server = createServer((request, response) => { void answer(request, response); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Panel shell test server did not expose a port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => { await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); await postgres.close(); },
  };
}

/** Opens the panel past the notification onboarding, once its text has its final metrics. */
export async function openPanelShell(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Seguir sin avisos en este dispositivo' }).click();
  await page.evaluate(async () => { await document.fonts.ready; });
}

/**
 * Saves the home name from Configuración and holds the request unanswered, so the panel keeps showing
 * its "Procesando…" pill while the test measures where it lands.
 */
export async function showPendingStatus(page: Page) {
  await page.route('**/api/settings', () => { /* left unanswered: the action stays pending */ });
  await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: 'Configuración' }).click();
  await page.getByRole('button', { name: 'Guardar nombre' }).click();
  const status = page.getByRole('status').filter({ hasText: 'Procesando…' });
  await expect(status).toBeVisible();
  return status;
}

export async function scrollPageToEnd(page: Page) {
  await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); });
}

/** The side rail scrolls on its own when its links do not fit the height of a phone in landscape. */
export async function scrollRailToEnd(page: Page) {
  await page.locator('.sidebar').evaluate((rail) => { rail.scrollTop = rail.scrollHeight; });
}

/** The section links of the side bar, failing instead of checking nothing when there are none. */
export async function sectionLinks(page: Page) {
  const links = page.locator('.sidebar nav a');
  await expect(links.first()).toBeVisible();
  return links.all();
}

export async function boxOf(locator: Locator) {
  // A missing element fails here, naming its locator, instead of as a null box.
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error('Panel shell test: a visible element returned no layout box');
  return { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height, width: box.width, height: box.height };
}

export function viewportOf(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Panel shell test: the page has no fixed viewport');
  return viewport;
}
