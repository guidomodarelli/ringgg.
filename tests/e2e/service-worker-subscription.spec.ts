import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { DOORBELL } from '../../src/constants/doorbell';
import { TIME } from '../../src/constants/time';
import { WORKER_MESSAGES } from '../../src/constants/push';
import { pushPayload } from '../../src/server/push';
import type { Visit } from '../../src/types/doorbell';
import { LIVE_RESIDENT, LIVE_RESIDENT_REQUIRED, createHome, deleteHome, onlyVisit, ringAsVisitor, ringPush, signInResident, type TestHome } from './support/resident-session';
import { attachWorkerDevtools, dropSubscription, nextApiResponse, recordWorkerMessages, shownNotifications, subscriptionEndpoint, tapNotification, workerMessages, type WorkerDevtools } from './support/service-worker-devtools';

// What only a subscribed worker sends: the receipt of each push and the renewal of its subscription. Incognito
// contexts cannot subscribe, so this browser has a profile of its own. It is Google Chrome, not Chrome for Testing:
// only Google's builds subscribe on fcm.googleapis.com, the provider the app accepts (Chromium's use a staging host).
// The first subscription of a profile registers with Google and takes about half a minute, so the tests share it.

/** Waits for the device to connect, which includes the browser's first registration with the push service. */
const FIRST_SUBSCRIPTION_TIMEOUT_MS = 90_000;
const SETUP_TIMEOUT_MS = 180_000;
const RESPONSE_WINDOW_MS = DOORBELL.responseWindowSeconds * TIME.secondMs;
/** Past the response window by this much, the server's `NOW()` is past it too. */
const CLOCK_MARGIN_MS = 1_000;
/** The whole response window, if this test runs first, plus the rest of the test. */
const EXPIRY_TEST_TIMEOUT_MS = RESPONSE_WINDOW_MS + 60_000;
const DEVICE_NAMES = { first: 'Chrome de la cocina', second: 'Chrome del living' };

/** The signed-in browser, connected to two homes under a different name in each, and the visit of the first. */
interface Resident { context: BrowserContext; page: Page; devtools: WorkerDevtools; origin: string; homes: { first: TestHome; second: TestHome }; visit: Visit }
let shared: Resident | undefined;

/** The shared setup; the tests only run once it finished. */
function sharedResident(): Resident {
  if (!shared) throw new Error('service-worker-subscription: the shared setup did not finish');
  return shared;
}

/** Connects this browser to a home from Devices, with the name it takes there. */
async function connectThisDevice(page: Page, home: TestHome, name: string) {
  await page.goto(`/?home=${home.id}&view=devices`);
  const devices = page.locator('#devices');
  await devices.getByLabel('Nombre de este dispositivo').fill(name);
  await devices.getByRole('button', { name: 'Conectar este dispositivo' }).click();
  await expect(devices.locator('.device-row').filter({ hasText: name }).getByText('Este dispositivo', { exact: true })).toBeVisible({ timeout: FIRST_SUBSCRIPTION_TIMEOUT_MS });
}

/** Devices of `home` lists this browser by its subscription, under the name it has there, and does not ask to connect it. */
async function expectConnected(page: Page, home: TestHome, name: string) {
  await page.goto(`/?home=${home.id}&view=devices`);
  const devices = page.locator('#devices');
  await expect(devices.locator('.device-row').filter({ hasText: name }).getByText('Este dispositivo', { exact: true })).toBeVisible();
  await expect(devices.getByText('Este dispositivo no recibe avisos de esta casa.')).toHaveCount(0);
}

test.beforeAll(async ({ browser }, testInfo) => {
  test.skip(!LIVE_RESIDENT, LIVE_RESIDENT_REQUIRED);
  test.setTimeout(SETUP_TIMEOUT_MS);
  const origin = testInfo.project.use.baseURL ?? '';
  const context = await chromium.launchPersistentContext('', { channel: 'chrome', baseURL: origin, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.grantPermissions(['notifications'], { origin });
  await context.addInitScript(recordWorkerMessages);
  const page = context.pages()[0] ?? await context.newPage();
  await signInResident(page);
  const homes = { first: await createHome(page, origin), second: await createHome(page, origin) };
  // The visit rings before the device connects, so the server never sends it a real push: DevTools delivers them.
  const visitor = await ringAsVisitor(browser, origin, homes.first, 'Soy Juan, del delivery');
  await visitor.close();
  const visit = await onlyVisit(page, homes.first);
  await connectThisDevice(page, homes.first, DEVICE_NAMES.first);
  await connectThisDevice(page, homes.second, DEVICE_NAMES.second);
  shared = { context, page, origin, homes, visit, devtools: await attachWorkerDevtools(context, page, origin) };
});

test.afterAll(async () => {
  if (!shared) return;
  await deleteHome(shared.page, shared.origin, shared.homes.first.id);
  await deleteHome(shared.page, shared.origin, shared.homes.second.id);
  await shared.context.close();
});

test('el worker confirma el recibo del timbrazo con la sesión del residente y el panel lo muestra', async () => {
  const { context, page, devtools, homes, visit } = sharedResident();
  await page.goto(`/?home=${homes.first.id}&view=history`);
  const receipt = nextApiResponse(context, '/api/push-receipt');
  await devtools.deliverPush(ringPush(homes.first, visit));

  const response = await receipt;
  expect(response.request().postDataJSON()).toEqual({ endpoint: await subscriptionEndpoint(await devtools.worker()), visitId: visit.id });
  expect(response.status()).toBe(200);
  // The panel shows what the server stored.
  await page.reload();
  await expect(page.getByRole('article').filter({ hasText: visit.message })).toContainText('Lo recibió 1 celular');
  await page.goto(`/?home=${homes.first.id}&view=devices`);
  await expect(page.locator('#devices .device-row').filter({ hasText: DEVICE_NAMES.first })).toContainText('Recibió el último aviso');
});

test('si el navegador da de baja la suscripción, el worker se suscribe de nuevo y el dispositivo conserva sus casas y nombres', async () => {
  const { context, page, devtools, homes } = sharedResident();
  await page.goto(`/?home=${homes.first.id}&view=devices`);
  // The worker keeps the endpoint of the last push it confirmed: once the browser drops it, nothing else knows it.
  const receipt = nextApiResponse(context, '/api/push-receipt');
  await devtools.deliverPush(pushPayload({ kind: 'test', homeId: homes.first.id, title: `${homes.first.name}: tu timbre está listo`, body: 'Prueba' }));
  await receipt;
  const previousEndpoint = await subscriptionEndpoint(await devtools.worker());
  const renewal = nextApiResponse(context, '/api/renew-subscription');
  await dropSubscription(await devtools.worker());

  const response = await renewal;
  const renewedEndpoint = await subscriptionEndpoint(await devtools.worker());
  expect(renewedEndpoint).toMatch(/^https:\/\/fcm\.googleapis\.com\//);
  expect(renewedEndpoint).not.toBe(previousEndpoint);
  expect(response.request().postDataJSON()).toEqual({ previousEndpoint, subscription: expect.objectContaining({ endpoint: renewedEndpoint }) });
  expect(response.status()).toBe(200);
  await expectConnected(page, homes.first, DEVICE_NAMES.first);
  await expectConnected(page, homes.second, DEVICE_NAMES.second);
});

// It shares the visit of the setup, so its two-minute wait overlaps the browser's slow first subscription.
test('«Ya voy» desde la notificación de una visita vencida no la responde y el worker va a abrirla en el panel', async () => {
  test.setTimeout(EXPIRY_TEST_TIMEOUT_MS);
  const { context, page, devtools, homes, visit } = sharedResident();
  await page.goto(`/?home=${homes.first.id}&view=history`);
  await devtools.deliverPush(ringPush(homes.first, visit));
  await expect.poll(() => workerMessages(page)).toContainEqual({ type: WORKER_MESSAGES.push, visitId: visit.id });
  // The notification still offers its replies after the response window, which the server's clock (this machine's) closes.
  await expect.poll(() => Date.now() - Date.parse(visit.created_at), { timeout: EXPIRY_TEST_TIMEOUT_MS, intervals: [TIME.secondMs] }).toBeGreaterThan(RESPONSE_WINDOW_MS + CLOCK_MARGIN_MS);
  const answered = nextApiResponse(context, '/api/answer');
  await tapNotification(await devtools.worker(), visit.id, 'reply:coming');

  expect((await answered).status()).toBe(409);
  // Instead it goes to focus the open panel on the visit, which Chromium refuses for a tap built by script.
  await expect.poll(() => devtools.errors).toContainEqual(expect.stringContaining('Not allowed to focus a window'));
  await expect.poll(() => shownNotifications(page, visit.id)).toEqual([]);
  expect(await onlyVisit(page, homes.first)).toMatchObject({ answered_at: null, reply: null });
});
