import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createServer, type IncomingMessage } from 'node:http';
import { createTestHarness, type TestHarness } from 'wrangler';
import { CHAT, CHAT_HEADERS, CHAT_PATHS } from '../src/constants/chat';
import { TIME } from '../src/constants/time';
import { chatRoomName, chatSocketUrl, signChatToken, verifyNotification, type ChatClaims, type ChatMessage, type ChatRole, type ServerChatMessage } from '../src/lib/chat-protocol';
import { readText } from './e2e/support/read-text';

// The real Worker in workerd, built from the same `wrangler.jsonc` that is deployed: Durable Objects,
// their SQLite, hibernatable sockets and alarms. Only the app that receives notifications is a local server.

const SECRET = 'ringgg-chat-test-secret-with-32-characters';
const STARTUP_TIMEOUT_MS = 90_000;
const MESSAGE_TIMEOUT_MS = 5_000;
/** The erasure alarm of an expired room fires right away, but the runtime schedules it on its own. */
const ERASURE_TIMEOUT_MS = 10_000;

interface ReceivedNotification { body: string; verified: boolean }

/** The app's notification route: it records each request and whether its signature checks out. */
async function startNotificationReceiver() {
  const received: ReceivedNotification[] = [];
  const server = createServer((request: IncomingMessage, response) => {
    void readText(request).then(async (body) => {
      const verified = request.url === CHAT_PATHS.notify && await verifyNotification({ body, timestamp: request.headers[CHAT_HEADERS.timestamp] as string, signature: request.headers[CHAT_HEADERS.signature] as string }, SECRET);
      received.push({ body, verified });
      response.statusCode = 204;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Notification receiver did not expose a TCP port');
  return { origin: `http://127.0.0.1:${address.port}`, received, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** A socket of the Worker with the messages it received, in order. */
interface ChatSocket { next: () => Promise<ServerChatMessage>; send: (id: string, body: string) => void }

let harness: TestHarness;
let workerUrl: string;
let receiver: Awaited<ReturnType<typeof startNotificationReceiver>>;

function claimsFor(role: ChatRole, overrides: Partial<ChatClaims> = {}): ChatClaims {
  const now = Date.now();
  return { visitId: crypto.randomUUID(), role, name: role === 'resident' ? 'Guido' : null, origin: receiver.origin, pageOrigin: receiver.origin, closesAt: now + CHAT.windowSeconds * TIME.secondMs, expiresAt: now + CHAT.tokenTtlSeconds * TIME.secondMs, ...overrides };
}

function upgrade(claims: ChatClaims, token: string, origin = claims.pageOrigin) {
  return harness.fetch(chatSocketUrl(workerUrl, claims.visitId), { headers: { Upgrade: 'websocket', Origin: origin, 'Sec-WebSocket-Protocol': `${CHAT.protocol}, ${token}` } });
}

async function connect(claims: ChatClaims): Promise<ChatSocket> {
  const response = await upgrade(claims, await signChatToken(claims, SECRET));
  const socket = response.webSocket;
  if (!socket) throw new Error(`Chat Worker did not upgrade visit ${claims.visitId}: HTTP ${response.status}`);
  expect(response.headers.get('Sec-WebSocket-Protocol')).toBe(CHAT.protocol);
  const queue: ServerChatMessage[] = [];
  const waiting: Array<(message: ServerChatMessage) => void> = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as ServerChatMessage;
    const resolve = waiting.shift();
    if (resolve) resolve(message); else queue.push(message);
  });
  socket.accept();
  const next = () => {
    const queued = queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise<ServerChatMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No chat message arrived within ${MESSAGE_TIMEOUT_MS} ms`)), MESSAGE_TIMEOUT_MS);
      waiting.push((message) => { clearTimeout(timer); resolve(message); });
    });
  };
  return { next, send: (id, body) => socket.send(JSON.stringify({ type: 'send', id, body })) };
}

async function history(chat: ChatSocket) {
  const message = await chat.next();
  if (message.type !== 'history') throw new Error(`Expected the history first, got ${message.type}`);
  return message;
}

async function delivered(chat: ChatSocket): Promise<ChatMessage> {
  const message = await chat.next();
  if (message.type !== 'message') throw new Error(`Expected a message, got ${JSON.stringify(message)}`);
  return message.message;
}

/** Waits until `count` notifications arrived; the Worker sends them after broadcasting the message. */
async function notifications(count: number) {
  await expect.poll(() => receiver.received.length, { timeout: MESSAGE_TIMEOUT_MS }).toBe(count);
  return receiver.received;
}

beforeAll(async () => {
  receiver = await startNotificationReceiver();
  harness = createTestHarness({ workers: [{ configPath: 'chat/wrangler.jsonc', secrets: { CHAT_SECRET: SECRET } }] });
  workerUrl = (await harness.listen()).url.origin;
}, STARTUP_TIMEOUT_MS);

afterAll(async () => {
  await harness.close();
  await receiver.close();
});

describe('acceso a la sala', () => {
  test('rechaza un token firmado con otro secreto, vencido, de otra visita o usado desde otro origen', async () => {
    const claims = claimsFor('visitor');
    expect((await upgrade(claims, await signChatToken(claims, 'otro-secreto-que-no-es-el-del-worker'))).status).toBe(401);
    expect((await upgrade(claims, await signChatToken({ ...claims, expiresAt: Date.now() - 1 }, SECRET))).status).toBe(401);
    expect((await upgrade(claims, await signChatToken({ ...claims, visitId: crypto.randomUUID() }, SECRET))).status).toBe(401);
    expect((await upgrade(claims, await signChatToken(claims, SECRET), 'https://otro-sitio.example')).status).toBe(401);
  });

  test('las páginas de un preview abiertas por su URL de rama y por la del deployment comparten la sala', async () => {
    const visitor = claimsFor('visitor');
    const resident = { ...visitor, role: 'resident' as const, name: 'Guido', pageOrigin: 'https://ringgg-abc123.vercel.app' };
    const visitorChat = await connect(visitor);
    const residentChat = await connect(resident);
    await history(visitorChat);
    await history(residentChat);
    visitorChat.send(crypto.randomUUID(), 'Hola desde la URL de la rama');
    expect((await delivered(residentChat)).body).toBe('Hola desde la URL de la rama');
    // The token is bound to the page it was issued to, not to every origin of the app.
    expect((await upgrade(resident, await signChatToken(resident, SECRET), visitor.pageOrigin)).status).toBe(401);
  });

  test('responde 426 sin upgrade y 404 fuera de una sala de visita', async () => {
    expect((await harness.fetch(chatSocketUrl(workerUrl, crypto.randomUUID()))).status).toBe(426);
    expect((await harness.fetch(`${workerUrl}/visits/no-es-una-visita`, { headers: { Upgrade: 'websocket' } })).status).toBe(404);
    expect(await (await harness.fetch(`${workerUrl}${CHAT_PATHS.health}`)).text()).toBe('ok');
  });
});

describe('mensajes', () => {
  test('la visita y los residentes se leen al instante, y la visita nunca ve quién respondió', async () => {
    const visitor = claimsFor('visitor');
    const resident = { ...visitor, role: 'resident' as const, name: 'Guido' };
    const visitorChat = await connect(visitor);
    const residentChat = await connect(resident);
    expect((await history(visitorChat)).messages).toEqual([]);
    expect((await history(residentChat)).closesAt).toBe(visitor.closesAt);

    visitorChat.send(crypto.randomUUID(), '  Hola, traigo un paquete  ');
    expect(await delivered(residentChat)).toMatchObject({ author: 'visitor', name: null, body: 'Hola, traigo un paquete' });
    expect((await delivered(visitorChat)).body).toBe('Hola, traigo un paquete');

    residentChat.send(crypto.randomUUID(), 'Ya bajo');
    expect(await delivered(visitorChat)).toMatchObject({ author: 'resident', name: null, body: 'Ya bajo' });
    expect(await delivered(residentChat)).toMatchObject({ author: 'resident', name: 'Guido', body: 'Ya bajo' });

    // A socket that opens later reads the whole conversation, with names only for residents.
    const lateResident = await connect({ ...resident, name: 'Ana' });
    expect((await history(lateResident)).messages.map((message) => [message.author, message.name, message.body])).toEqual([['visitor', null, 'Hola, traigo un paquete'], ['resident', 'Guido', 'Ya bajo']]);
    const visitorAgain = await connect(visitor);
    expect((await history(visitorAgain)).messages.map((message) => message.name)).toEqual([null, null]);
  });

  test('un reintento con el mismo id no duplica el mensaje y solo se lo confirma a quien lo reenvió', async () => {
    const visitor = claimsFor('visitor');
    const visitorChat = await connect(visitor);
    const residentChat = await connect({ ...visitor, role: 'resident', name: 'Guido' });
    await history(visitorChat); await history(residentChat);
    const id = crypto.randomUUID();
    visitorChat.send(id, 'Estoy en la puerta');
    expect((await delivered(residentChat)).id).toBe(id);
    expect((await delivered(visitorChat)).id).toBe(id);
    visitorChat.send(id, 'Estoy en la puerta');
    expect((await delivered(visitorChat)).id).toBe(id);
    // The resident only receives the next new message, not the retry.
    residentChat.send(crypto.randomUUID(), 'Voy');
    expect((await delivered(residentChat)).body).toBe('Voy');
    const reread = await connect(visitor);
    expect((await history(reread)).messages).toHaveLength(2);
  });

  test('rechaza mensajes vacíos o demasiado largos, y todos cuando el chat ya terminó', async () => {
    const visitorChat = await connect(claimsFor('visitor'));
    await history(visitorChat);
    const empty = crypto.randomUUID();
    visitorChat.send(empty, '   ');
    expect(await visitorChat.next()).toEqual({ type: 'rejected', id: '', code: 'MESSAGE_INVALID' });
    visitorChat.send(crypto.randomUUID(), 'x'.repeat(CHAT.messageMaxLength + 1));
    expect(await visitorChat.next()).toMatchObject({ type: 'rejected', code: 'MESSAGE_INVALID' });

    const closed = await connect(claimsFor('resident', { closesAt: Date.now() - 1 }));
    await history(closed);
    const late = crypto.randomUUID();
    closed.send(late, 'Llego tarde');
    expect(await closed.next()).toEqual({ type: 'rejected', id: late, code: 'CHAT_CLOSED' });
  });
});

describe('avisos a los residentes', () => {
  test('avisa a la app con una firma válida cuando nadie de la casa tiene el chat abierto, una vez por cooldown', async () => {
    const before = receiver.received.length;
    const visitorChat = await connect(claimsFor('visitor'));
    await history(visitorChat);
    const first = crypto.randomUUID();
    visitorChat.send(first, 'Toqué y no atienden');
    await delivered(visitorChat);
    const [notification] = (await notifications(before + 1)).slice(before);
    expect(notification.verified).toBe(true);
    expect(JSON.parse(notification.body)).toMatchObject({ messageId: first, body: 'Toqué y no atienden' });

    visitorChat.send(crypto.randomUUID(), '¿Hay alguien?');
    await delivered(visitorChat);
    // Inside the cooldown the second message does not notify again.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(receiver.received).toHaveLength(before + 1);
  });

  test('no avisa cuando un residente está leyendo el chat', async () => {
    const before = receiver.received.length;
    const visitor = claimsFor('visitor');
    const visitorChat = await connect(visitor);
    const residentChat = await connect({ ...visitor, role: 'resident', name: 'Guido' });
    await history(visitorChat); await history(residentChat);
    visitorChat.send(crypto.randomUUID(), 'Hola');
    await delivered(residentChat);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(receiver.received).toHaveLength(before);
  });
});

describe('retención', () => {
  /** How many tables the room of these claims keeps in its SQLite, read through the harness. */
  async function storedTables(claims: ChatClaims) {
    const storage = await harness.getWorker().getDurableObjectStorage('CHAT_ROOMS', { name: chatRoomName(claims.origin, claims.visitId) });
    return (await storage.exec("SELECT name FROM sqlite_master WHERE type = 'table'")).length;
  }

  test('una visita del historial conserva su sala; una que salió del historial la borra sola y se puede volver a abrir vacía', async () => {
    const current = claimsFor('resident');
    await history(await connect(current));
    expect(await storedTables(current)).toBeGreaterThan(0);

    const expired = claimsFor('resident', { closesAt: Date.now() - CHAT.retentionDays * TIME.dayMs - TIME.secondMs });
    await history(await connect(expired));
    await expect.poll(() => storedTables(expired), { timeout: ERASURE_TIMEOUT_MS }).toBe(0);
    expect((await history(await connect(expired))).messages).toEqual([]);
  }, ERASURE_TIMEOUT_MS * 2);
});
