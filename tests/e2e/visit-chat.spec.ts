import { test, expect, type Browser, type Page } from '@playwright/test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { createTestHarness, type TestHarness } from 'wrangler';
import { CHAT, CHAT_HEADERS, CHAT_PATHS } from '../../src/constants/chat';
import { DOORBELL, VISIT_REPLIES } from '../../src/constants/doorbell';
import { HOMES } from '../../src/constants/homes';
import { VISITOR_POLLING } from '../../src/constants/polling';
import { TIME } from '../../src/constants/time';
import { chatRoomName } from '../../src/lib/chat-protocol';
import { announceAnswer, notifyChatMessage, residentChatAccess, visitorChatAccess, type ChatSettings } from '../../src/server/chat';
import { initialize, type Database } from '../../src/server/database';
import { answerVisit, getHome, publicHome, readVisit, registerVisit, setDelivery, snapshot } from '../../src/server/doorbell';
import { AppError } from '../../src/server/errors';
import type { Home } from '../../src/types/doorbell';
import { testDatabase } from '../support/test-database';
import { bundleFixture } from './support/bundle-fixture';
import { readText } from './support/read-text';

// Real React components in Chromium, the real chat Worker in workerd (Durable Objects, SQLite and
// hibernatable sockets) and real PostgreSQL. Only the resident's session is outside the fixture.

const SECRET = 'ringgg-chat-e2e-secret-with-32-characters';
const HOME = HOMES.originalId;
const owner = { id: 'owner-identity', email: 'owner@example.com', name: 'Guido', emailVerified: true };
const residents = { bootstrapEmails: [owner.email] };

let harness: TestHarness;
let workerUrl: string;

test.beforeAll(async () => {
  harness = createTestHarness({ workers: [{ configPath: 'chat/wrangler.jsonc', secrets: { CHAT_SECRET: SECRET } }] });
  workerUrl = (await harness.listen()).url.origin.replace(/^http/, 'ws');
});
test.afterAll(async () => { await harness.close(); });

interface ChatFixtureServer { url: string; database: Database; home: Home; settings: () => ChatSettings; notifications: () => number; close: () => Promise<void> }

/** The visitor's check of its ring, `/api/door/<qr>/visits/<id>`, and not its chat token. */
const VISIT_POLL = /\/api\/door\/[^/]+\/visits\/[0-9a-f-]{36}$/;

function sendError(response: ServerResponse, error: unknown) {
  response.statusCode = error instanceof AppError ? error.status : 500;
  response.end(JSON.stringify({ error: error instanceof AppError ? error.message : 'No se pudo completar la prueba.' }));
}

/** The app's routes the chat uses, over the same origin the pages load from, as in production. */
async function startFixture(): Promise<ChatFixtureServer> {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const home = await getHome(database, HOME);
  const bundled = await bundleFixture('tests/fixtures/visit-chat-entry.tsx');
  let origin = '';
  let notified = 0;
  const settings = (): ChatSettings => ({ url: workerUrl, secret: SECRET, origin, allowedOrigins: [origin] });

  async function api(request: IncomingMessage, url: URL) {
    const path = url.pathname.slice('/api/'.length);
    const [, token, , id, action] = path.split('/');
    if (request.method === 'POST' && path === `door/${home.token}`) {
      const input = JSON.parse(await readText(request)) as { id: string; message: string };
      const result = await registerVisit(database, token, { id: input.id, message: input.message, client: 'fixture-client' });
      if (result.created) await setDelivery(database, input.id, 'unavailable');
      return readVisit(database, token, input.id);
    }
    if (action === 'chat') return visitorChatAccess(database, token, id, { settings: settings() });
    if (id && !action) return readVisit(database, token, id);
    if (path === 'chat/access') return residentChatAccess(database, owner, url.searchParams.get('visit') ?? '', { settings: settings(), residents });
    if (`/api/${path}` === CHAT_PATHS.notify) {
      const body = await readText(request);
      await notifyChatMessage(database, { body, timestamp: request.headers[CHAT_HEADERS.timestamp] as string, signature: request.headers[CHAT_HEADERS.signature] as string }, { settings: settings() });
      notified += 1;
      return null;
    }
    return undefined;
  }

  async function page(url: URL) {
    if (url.pathname === '/panel') {
      const { visits } = await snapshot(database, HOME);
      return { page: 'resident', visits, homeName: home.name, focusVisitId: visits[0]?.id ?? '' };
    }
    return { page: 'visitor', home: await publicHome(database, home.token), token: home.token };
  }

  async function answer(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', origin);
    if (url.pathname === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled); return; }
    try {
      if (url.pathname.startsWith('/api/')) {
        response.setHeader('Content-Type', 'application/json');
        const result = await api(request, url);
        if (result === undefined) { response.statusCode = 404; response.end('{}'); return; }
        if (result === null) { response.statusCode = 204; response.end(); return; }
        response.end(JSON.stringify(result));
        return;
      }
      response.setHeader('Content-Type', 'text/html');
      response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><body><div id="root"></div><script>window.__CHAT_FIXTURE__=${JSON.stringify(await page(url))}</script><script src="/bundle.js"></script></body></html>`);
    } catch (error) { sendError(response, error); }
  }

  const server = createServer((request, response) => { void answer(request, response); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Chat fixture server did not expose a TCP port');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: origin, database, home, settings, notifications: () => notified,
    close: async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await postgres.close(); },
  };
}

async function ringAndOpenChat(browser: Browser, fixture: ChatFixtureServer) {
  const page = await browser.newPage();
  await page.goto(fixture.url);
  await page.getByRole('button', { name: 'Tocar timbre', exact: true }).click();
  const chat = page.getByRole('region', { name: `Chat con ${fixture.home.name}` });
  await expect(chat.getByText('Escribiles acá', { exact: false })).toBeVisible();
  return { page, chat };
}

async function write(page: Page, region: ReturnType<Page['getByRole']>, text: string) {
  await region.getByLabel('Mensaje', { exact: true }).fill(text);
  await region.getByLabel('Mensaje', { exact: true }).press('Enter');
}

test('la visita y un residente chatean en vivo, y la visita nunca ve quién responde', async ({ browser }) => {
  const fixture = await startFixture();
  try {
    const visitor = await ringAndOpenChat(browser, fixture);
    await write(visitor.page, visitor.chat, 'Hola, traigo un paquete');
    await expect(visitor.chat.getByRole('log')).toContainText('Vos');
    await expect(visitor.chat.getByRole('log')).toContainText('Hola, traigo un paquete');
    await expect(visitor.chat.getByText('Enviando…')).toHaveCount(0);
    // Nobody in the home had the chat open: the Worker asked the app to notify the residents.
    await expect.poll(fixture.notifications).toBe(1);

    // Opening the panel from that notification opens the visit's chat by itself.
    const resident = await browser.newPage();
    await resident.goto(`${fixture.url}/panel`);
    const residentChat = resident.getByRole('region', { name: 'Chat con la visita' });
    await expect(residentChat.getByRole('log')).toContainText('Visita');
    await expect(residentChat.getByRole('log')).toContainText('Hola, traigo un paquete');
    await residentChat.getByLabel('Mensaje', { exact: true }).fill('Ya bajo');
    await residentChat.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(residentChat.getByLabel('Mensaje', { exact: true })).toHaveValue('');

    await expect(visitor.chat.getByRole('log')).toContainText('Ya bajo');
    await expect(visitor.chat.getByRole('log')).toContainText(fixture.home.name);
    await expect(visitor.chat.getByRole('log')).not.toContainText('Guido');
    await expect(residentChat.getByRole('log')).toContainText('Vos');

    // «Ocultar chat» closes the panel and the history row offers it again.
    await resident.getByRole('button', { name: 'Ocultar chat' }).click();
    await expect(residentChat).toHaveCount(0);
    await expect(resident.getByRole('button', { name: 'Chat con la visita' })).toHaveAttribute('aria-expanded', 'false');
  } finally { await fixture.close(); }
});

test('lo que se escribe mientras se corta la conexión sale al reconectar, una sola vez', async ({ browser }) => {
  const fixture = await startFixture();
  try {
    const visitor = await ringAndOpenChat(browser, fixture);
    const [visit] = (await snapshot(fixture.database, HOME)).visits;
    // The room drops every socket, as when the runtime restarts it.
    await harness.getWorker().evictDurableObject('CHAT_ROOMS', { name: chatRoomName(fixture.url, visit.id), webSockets: 'close' });
    await expect(visitor.chat.getByRole('status')).toContainText('Reconectando…');
    await write(visitor.page, visitor.chat, 'Escrito sin conexión');
    await expect(visitor.chat.getByText('Enviando…')).toBeVisible();
    await expect(visitor.chat.getByText('Enviando…')).toHaveCount(0, { timeout: CHAT.reconnect.maxDelayMs });
    await expect(visitor.chat.getByRole('status')).toHaveCount(0);

    const resident = await browser.newPage();
    await resident.goto(`${fixture.url}/panel`);
    const residentChat = resident.getByRole('region', { name: 'Chat con la visita' });
    await expect(residentChat.getByText('Escrito sin conexión')).toHaveCount(1);
  } finally { await fixture.close(); }
});

test('un chat que el residente dejó de ver no silencia los avisos y, al volver, muestra lo que se escribió aunque haya terminado', async ({ browser }) => {
  const fixture = await startFixture();
  try {
    const visitor = await browser.newPage();
    await visitor.goto(fixture.url);
    await visitor.getByRole('button', { name: 'Tocar timbre', exact: true }).click();
    const visitorChat = visitor.getByRole('region', { name: `Chat con ${fixture.home.name}` });
    await expect(visitorChat.getByText('Escribiles acá', { exact: false })).toBeVisible();

    const resident = await browser.newPage();
    await resident.clock.install();
    await resident.goto(`${fixture.url}/panel`);
    const residentChat = resident.getByRole('region', { name: 'Chat con la visita' });
    await expect(residentChat.getByText('La visita todavía no escribió', { exact: false })).toBeVisible();
    // Another dashboard section keeps the history mounted but hidden: its chat stops counting as reading.
    await resident.getByRole('button', { name: 'Ir al resumen' }).click();

    await write(visitor, visitorChat, 'Te dejo el paquete con el portero');
    await expect(visitorChat.getByText('Enviando…')).toHaveCount(0);
    await expect.poll(fixture.notifications).toBe(1);

    // The chat ends while the resident looks elsewhere; coming back reads what was said in the meantime.
    await resident.clock.fastForward(CHAT.windowSeconds * 1000);
    await resident.getByRole('button', { name: 'Volver a Timbrazos' }).click();
    await expect(residentChat.getByRole('log')).toContainText('Te dejo el paquete con el portero');
    await expect(residentChat.getByText('El chat de esta visita terminó.')).toBeVisible();
    await expect(residentChat.getByLabel('Mensaje', { exact: true })).toHaveCount(0);
  } finally { await fixture.close(); }
});

test('el chat se cierra al terminar su ventana: la visita vuelve al timbre y el residente solo lo lee', async ({ browser }) => {
  const fixture = await startFixture();
  try {
    const page = await browser.newPage();
    await page.clock.install();
    await page.goto(fixture.url);
    await page.getByRole('button', { name: 'Tocar timbre', exact: true }).click();
    const chat = page.getByRole('region', { name: `Chat con ${fixture.home.name}` });
    await write(page, chat, 'Te espero en la puerta');
    await expect(chat.getByRole('log')).toContainText('Te espero en la puerta');
    await expect(chat.getByText('Enviando…')).toHaveCount(0);
    await page.clock.fastForward(CHAT.windowSeconds * 1000);
    // The ring's window closed with the page open: the doorbell comes back, as without the chat.
    await expect(page.getByRole('button', { name: 'Tocar timbre', exact: true })).toBeVisible();
    await expect(chat).toHaveCount(0);

    // Once the window passed on the server too, a resident reads the conversation without a composer.
    const [visit] = (await snapshot(fixture.database, HOME)).visits;
    await fixture.database.query(`UPDATE visits SET created_at = NOW() - $2 * INTERVAL '1 second' WHERE id = $1`, [visit.id, CHAT.windowSeconds + 1]);
    const resident = await browser.newPage();
    await resident.goto(`${fixture.url}/panel`);
    await resident.getByRole('button', { name: 'Chat con la visita' }).click();
    const residentChat = resident.getByRole('region', { name: 'Chat con la visita' });
    await expect(residentChat.getByRole('log')).toContainText('Te espero en la puerta');
    await expect(residentChat.getByText('El chat de esta visita terminó.')).toBeVisible();
    await expect(residentChat.getByLabel('Mensaje', { exact: true })).toHaveCount(0);
  } finally { await fixture.close(); }
});

/** Rings from a new page and waits until the chat's socket is live: «Conectando el chat…» is gone. */
async function ringWithLiveChat(page: Page, fixture: ChatFixtureServer) {
  await page.goto(fixture.url);
  await page.getByRole('button', { name: 'Tocar timbre', exact: true }).click();
  const chat = page.getByRole('region', { name: `Chat con ${fixture.home.name}` });
  await expect(chat.getByText('Escribiles acá', { exact: false })).toBeVisible();
  await expect(chat.getByRole('status')).toHaveCount(0);
  return chat;
}

test('el «Ya voy» de un residente le llega a la visita al instante por el chat, sin quién respondió', async ({ browser }) => {
  const fixture = await startFixture();
  try {
    const page = await browser.newPage();
    // The visitor's checks always see the visit unanswered: the answer can only come through the socket.
    await page.route(VISIT_POLL, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), answered_at: null, reply: null } });
    });
    await ringWithLiveChat(page, fixture);
    await expect(page.getByText('Esperando respuesta')).toBeVisible();

    const [visit] = (await snapshot(fixture.database, HOME)).visits;
    await announceAnswer(await answerVisit(fixture.database, { homeId: HOME, id: visit.id }, 'coming', owner.name), { settings: fixture.settings() });
    await expect(page.getByRole('heading', { name: VISIT_REPLIES.coming.visitorTitle })).toBeVisible();
    await expect(page.getByText('Esperando respuesta')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(owner.name);
  } finally { await fixture.close(); }
});

test('con el chat en vivo la visita revisa su timbrazo solo de respaldo, y al vencer la ventana igual ve que no respondieron', async ({ browser }) => {
  const fixture = await startFixture();
  try {
    const page = await browser.newPage();
    await page.clock.install();
    let checks = 0;
    page.on('request', (request) => { if (VISIT_POLL.test(request.url())) checks += 1; });
    await ringWithLiveChat(page, fixture);
    // Without the socket it would have checked every 5 seconds by now.
    await page.clock.runFor(3 * VISITOR_POLLING.answerMs);
    expect(checks).toBe(0);
    // The window still ends on time: the backup check reads the final state right after it.
    await page.clock.runFor(DOORBELL.responseWindowSeconds * TIME.secondMs);
    await expect(page.getByRole('heading', { name: 'Todavía no respondieron' })).toBeVisible();
  } finally { await fixture.close(); }
});
