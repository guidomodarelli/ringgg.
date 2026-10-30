import { test, expect, type Page } from '@playwright/test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { initialize } from '../../src/server/database';
import { answerVisit, getHome, registerVisit, rotateToken, snapshot, updateHomeName, updateQuietHours } from '../../src/server/doorbell';
import { saveDevice } from '../../src/server/push';
import { FIXTURE_HOME, apiPath, dashboardInitial } from './support/dashboard-initial';
import { testDatabase } from '../support/test-database';
import { pushSubscription } from '../support/push-subscription';
import { bundleFixture } from './support/bundle-fixture';
import { readText } from './support/read-text';

interface MeasuredWindow { requests: string[]; requestCount: number; commits: number }

/** The panel settled after loading: this browser reported its device and the QR finished drawing. */
async function waitUntilSettled(page: Page) {
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('.setup-callout')).toHaveCount(0);
  await expect(page.locator('.qr-frame img')).toHaveCount(1);
}

// Real Dashboard, HTTP transport and PostgreSQL; only the auth client and the Next router are stubbed.
test('el panel reconcilia cada acción con su propia respuesta y no re-renderiza si el polling no trae cambios', async ({ page }) => {
  test.setTimeout(120_000);
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  const resident = { id: 'reconcile-resident', email: 'guido@example.com', emailVerified: true, homeId: FIXTURE_HOME, displayName: 'Guido' };
  /** Every action of the panel names its home, as the server routes require. */
  const sentHomes = new Set<unknown>();
  await initialize(database);
  // This browser's device: push counts as active while the home's snapshot lists it.
  const { deviceId } = await saveDevice(database, { homeId: FIXTURE_HOME, name: 'Compu de Guido', subscription: pushSubscription('perf') }, resident, { bootstrapEmails: [resident.email] });
  const bundled = await bundleFixture('tests/fixtures/dashboard-entry.tsx', { development: true, stubAuthClient: true });
  const css = readFileSync('src/app/globals.css', 'utf8');
  const hits: string[] = [];
  const readJson = async (request: IncomingMessage) => JSON.parse(await readText(request) || '{}');
  async function answerApi(request: IncomingMessage, response: ServerResponse, url: string) {
    hits.push(`${request.method} ${url}`); response.setHeader('Content-Type', 'application/json');
    const path = apiPath(url);
    if (path === 'dashboard') { sentHomes.add(Number(new URL(url, 'http://127.0.0.1').searchParams.get('home'))); return response.end(JSON.stringify(await snapshot(database, FIXTURE_HOME))); }
    if (path === 'settings') { const input = await readJson(request); sentHomes.add(input.home); await updateHomeName(database, resident, input.name, { bootstrapEmails: [resident.email] }); return response.end(JSON.stringify(await snapshot(database, FIXTURE_HOME))); }
    if (path === 'quiet-hours') { const input = await readJson(request); sentHomes.add(input.home); await updateQuietHours(database, FIXTURE_HOME, input.start, input.end); return response.end(JSON.stringify(await snapshot(database, FIXTURE_HOME))); }
    if (path === 'rotate') { sentHomes.add((await readJson(request)).home); await rotateToken(database, FIXTURE_HOME); return response.end(JSON.stringify(await snapshot(database, FIXTURE_HOME))); }
    if (path === 'device-status') return response.end(JSON.stringify({ active: true, deviceId }));
    if (path === 'answer') { const input = await readJson(request); return response.end(JSON.stringify(await answerVisit(database, { homeId: FIXTURE_HOME, id: input.id }, input.reply, 'Guido'))); }
    response.statusCode = 404; return response.end('{}');
  }
  async function answer(request: IncomingMessage, response: ServerResponse) {
    const url = request.url || '/';
    if (url === '/bundle.js') { response.end(bundled); return; }
    if (url.startsWith('/api/')) { await answerApi(request, response, url); return; }
    if (url === '/sw.js') { response.statusCode = 404; response.end(''); return; }
    const initial = await dashboardInitial(database);
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><style>${css}</style><body><div id="root"></div><script>window.__INITIAL__=${JSON.stringify(initial)}</script><script src="/bundle.js"></script></body></html>`);
  }
  const server = createServer((request, response) => { void answer(request, response); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  const results: Record<string, MeasuredWindow> = {};
  const commits = () => page.evaluate(() => (window as unknown as { __commits: number }).__commits);
  const measureWindow = async (label: string, work: () => Promise<unknown>) => { hits.length = 0; const commitsBefore = await commits(); await work(); const commitsAfter = await commits(); results[label] = { requests: [...hits], requestCount: hits.length, commits: commitsAfter - commitsBefore }; };
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Notification', { value: { permission: 'granted', requestPermission: async () => 'granted' } });
    Object.defineProperty(window, 'PushManager', { value: function PushManager() {} });
    const registration = { pushManager: { getSubscription: async () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/perf' }) } };
    Object.defineProperty(navigator, 'serviceWorker', { value: { register: async () => registration, ready: Promise.resolve(registration), addEventListener() {}, removeEventListener() {} } });
  });
  await page.clock.install();
  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    await waitUntilSettled(page);
    // The first check after load uses the cadence without push; this browser then reports an active device.
    await page.clock.runFor(31_000);
    // That check is a real fetch: wait until the server records it so it is not counted inside the idle window.
    await expect.poll(() => hits.filter((hit) => hit.startsWith('GET /api/dashboard')).length).toBe(1);
    await measureWindow('idle', () => page.clock.runFor(65_000));
    await page.goto(`http://127.0.0.1:${port}/?home=${FIXTURE_HOME}&view=settings`); await waitUntilSettled(page);
    await measureWindow('rename home', async () => { await page.getByLabel('Nombre de tu casa').fill('Casa perf'); await page.getByRole('button', { name: 'Guardar nombre' }).click(); await page.getByText('Nombre actualizado.').waitFor(); await expect(page.locator('.home-switcher summary')).toHaveText('Casa perf'); });
    await page.getByRole('button', { name: 'Configurar horario' }).click();
    await measureWindow('save quiet hours', async () => { await page.getByRole('button', { name: 'Guardar horario' }).click(); await page.getByText('Horario de descanso guardado', { exact: false }).waitFor(); });
    await updateQuietHours(database, FIXTURE_HOME, null, null);
    const home = await getHome(database, FIXTURE_HOME); const id = crypto.randomUUID(); await registerVisit(database, home.token, { id, message: 'Perf visit', client: 'perf-client' });
    await page.goto(`http://127.0.0.1:${port}/?home=${FIXTURE_HOME}&view=history`); await waitUntilSettled(page);
    await measureWindow('answer visit', async () => { await page.getByRole('button', { name: 'Ya voy', exact: true }).click(); await page.getByText('Atendido', { exact: true }).waitFor(); });
    await page.goto(`http://127.0.0.1:${port}/?home=${FIXTURE_HOME}&view=qr`); await waitUntilSettled(page);
    await measureWindow('rotate QR', async () => { await page.getByRole('button', { name: 'Regenerar QR' }).click(); await page.getByRole('button', { name: 'Sí, crear nuevo QR' }).click(); await page.getByText('Nuevo QR creado', { exact: false }).waitFor(); });
    // A tab suspended during the answer window resumes after it: the buttons must disappear.
    const late = crypto.randomUUID(); await registerVisit(database, (await getHome(database, FIXTURE_HOME)).token, { id: late, message: 'Visita suspendida', client: 'perf-client-2' });
    await page.goto(`http://127.0.0.1:${port}/?home=${FIXTURE_HOME}&view=history`);
    await expect(page.getByRole('button', { name: 'Ya voy', exact: true })).toBeVisible();
    await page.clock.fastForward('02:10');
    await expect(page.getByRole('button', { name: 'Ya voy', exact: true })).toHaveCount(0, { timeout: 15_000 });
  } finally { server.close(); await postgres.close(); }
  // With notifications active the panel checks once a minute as a backup (it used to check every 5 s).
  expect(results.idle.requests).toEqual([`GET /api/dashboard?home=${FIXTURE_HOME}`]);
  expect([...sentHomes]).toEqual([FIXTURE_HOME]);
  expect(results.idle.commits).toBe(0);
  expect(results['rename home'].requests).toEqual(['POST /api/settings']);
  expect(results['save quiet hours'].requests).toEqual(['POST /api/quiet-hours']);
  expect(results['answer visit'].requests).toEqual(['POST /api/answer']);
  expect(results['rotate QR'].requests).toEqual(['POST /api/rotate']);
});
