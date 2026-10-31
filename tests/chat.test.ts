import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import nock from 'nock';
import { CHAT } from '../src/constants/chat';
import { HOMES } from '../src/constants/homes';
import { PUSH_POLICIES } from '../src/constants/push';
import { TIME } from '../src/constants/time';
import { parseClientChatMessage, signChatToken, signNotification, tokenFromProtocols, verifyChatToken, type ChatClaims } from '../src/lib/chat-protocol';
import { chatSettings, notifyChatMessage, residentChatAccess, visitorChatAccess, type ChatSettings } from '../src/server/chat';
import { initialize } from '../src/server/database';
import { getHome, registerVisit } from '../src/server/doorbell';
import { productionEnvironmentProblems } from '../src/server/environment';
import { addResident, renameResident } from '../src/server/residents';
import { saveDevice } from '../src/server/push';
import { testDatabase } from './support/test-database';
import { PUSH_SERVICE, pushSubscription, withProvider } from './support/push-subscription';

const postgres = new PGlite();
const database = testDatabase(postgres);
const HOME = HOMES.originalId;
const SECRET = 'ringgg-chat-secret-for-tests-32-chars!!';
const SETTINGS: ChatSettings = { url: 'wss://chat.ringgg.test', secret: SECRET, origin: 'https://ringgg.test' };
const owner = { id: 'owner-identity', email: 'owner@example.com', name: 'Guido', emailVerified: true };
const stranger = { id: 'stranger-identity', email: 'stranger@example.com', name: 'Otra persona', emailVerified: true };
const residents = { bootstrapEmails: [owner.email] };

async function ring(message = '') {
  const home = await getHome(database, HOME);
  const id = crypto.randomUUID();
  await registerVisit(database, home.token, { id, message, client: `client-${id}` });
  return { token: home.token, id };
}

const age = (id: string, seconds: number) => database.query(`UPDATE visits SET created_at = NOW() - $2 * INTERVAL '1 second' WHERE id = $1`, [id, seconds]);
const createdAt = async (id: string) => new Date((await database.query<{ created_at: Date }>('SELECT created_at FROM visits WHERE id = $1', [id])).rows[0].created_at).getTime();

async function signed(payload: unknown, timestampSeconds = Math.floor(Date.now() / TIME.secondMs), secret = SECRET) {
  const body = JSON.stringify(payload);
  return { body, timestamp: String(timestampSeconds), signature: await signNotification(body, timestampSeconds, secret) };
}

beforeAll(async () => { await initialize(database); });
beforeEach(async () => {
  for (const table of ['home_members', 'devices', 'visits', 'rate_limits']) await database.query(`DELETE FROM ${table}`);
});
afterAll(async () => { await postgres.close(); });

describe('configuración', () => {
  test('el chat existe solo con la URL del Worker y un secreto largo; si no, queda la nota', () => {
    expect(chatSettings({})).toBeNull();
    expect(chatSettings({ CHAT_URL: 'wss://chat.example', CHAT_SECRET: 'corto' })).toBeNull();
    expect(chatSettings({ CHAT_URL: 'wss://chat.example/', CHAT_SECRET: SECRET, APP_URL: 'https://ringgg.test' })).toEqual({ url: 'wss://chat.example', secret: SECRET, origin: 'https://ringgg.test' });
  });

  test('producción rechaza el chat a medio configurar, sin mostrar sus valores', () => {
    const problems = (env: Record<string, string>) => productionEnvironmentProblems(env).filter((problem) => problem.variable.startsWith('CHAT_'));
    expect(problems({})).toEqual([]);
    expect(problems({ CHAT_URL: 'https://chat.example', CHAT_SECRET: SECRET }).map((problem) => problem.variable)).toEqual(['CHAT_URL']);
    expect(problems({ CHAT_URL: 'wss://chat.example' }).map((problem) => problem.variable)).toEqual(['CHAT_SECRET']);
    expect(JSON.stringify(problems({ CHAT_URL: 'wss://chat.example', CHAT_SECRET: 'corto-y-privado' }))).not.toContain('corto-y-privado');
  });
});

describe('tokens', () => {
  test('un token solo vale con su secreto, sin alterar y antes de vencer', async () => {
    const claims: ChatClaims = { visitId: crypto.randomUUID(), role: 'resident', name: 'Guido', origin: SETTINGS.origin, closesAt: Date.now(), expiresAt: Date.now() + 60_000 };
    const token = await signChatToken(claims, SECRET);
    expect(await verifyChatToken(token, SECRET)).toEqual(claims);
    expect(await verifyChatToken(token, 'otro-secreto-cualquiera-de-32-caracteres')).toBeNull();
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, role: 'visitor' })).toString('base64url');
    expect(await verifyChatToken(`${forged}.${signature}`, SECRET)).toBeNull();
    expect(await verifyChatToken(`${payload}.${signature}.extra`, SECRET)).toBeNull();
    expect(await verifyChatToken(token, SECRET, claims.expiresAt)).toBeNull();
  });

  test('el token viaja en el subprotocolo del socket, nunca en la URL', () => {
    expect(tokenFromProtocols(`${CHAT.protocol}, abc.def`)).toBe('abc.def');
    expect(tokenFromProtocols('otro-protocolo, abc.def')).toBeNull();
    expect(tokenFromProtocols(CHAT.protocol)).toBeNull();
    expect(tokenFromProtocols(null)).toBeNull();
  });

  test('un mensaje del socket necesita id de visita válido y texto de hasta el máximo', () => {
    const id = crypto.randomUUID();
    expect(parseClientChatMessage(JSON.stringify({ type: 'send', id, body: '  Hola  ' }))).toEqual({ type: 'send', id, body: 'Hola' });
    expect(parseClientChatMessage(JSON.stringify({ type: 'send', id: 'uno', body: 'Hola' }))).toBeNull();
    expect(parseClientChatMessage(JSON.stringify({ type: 'send', id, body: 'x'.repeat(CHAT.messageMaxLength + 1) }))).toBeNull();
    expect(parseClientChatMessage('no es json')).toBeNull();
  });
});

describe('acceso de la visita', () => {
  test('la visita recibe un token de su propio timbrazo, sin nombre, que cierra con la ventana del chat', async () => {
    const visit = await ring();
    const access = await visitorChatAccess(database, visit.token, visit.id, { settings: SETTINGS });
    expect(access.url).toBe(`${SETTINGS.url}/visits/${visit.id}`);
    expect(access.closesAt).toBe(await createdAt(visit.id) + CHAT.windowSeconds * TIME.secondMs);
    expect(await verifyChatToken(access.token, SECRET)).toMatchObject({ visitId: visit.id, role: 'visitor', name: null, origin: SETTINGS.origin, closesAt: access.closesAt });
  });

  test('sin chat, con otro QR, con una visita ajena o con el chat cerrado no hay token', async () => {
    const visit = await ring();
    await expect(visitorChatAccess(database, visit.token, visit.id, { settings: null })).rejects.toMatchObject({ code: 'CHAT_UNAVAILABLE' });
    await expect(visitorChatAccess(database, 'qr-viejo', visit.id, { settings: SETTINGS })).rejects.toMatchObject({ code: 'INVALID_DOORBELL' });
    await expect(visitorChatAccess(database, visit.token, crypto.randomUUID(), { settings: SETTINGS })).rejects.toMatchObject({ code: 'VISIT_NOT_FOUND' });
    await expect(visitorChatAccess(database, visit.token, 'no-es-un-id', { settings: SETTINGS })).rejects.toMatchObject({ code: 'VISIT_NOT_FOUND' });
    await age(visit.id, CHAT.windowSeconds + 1);
    await expect(visitorChatAccess(database, visit.token, visit.id, { settings: SETTINGS })).rejects.toMatchObject({ code: 'CHAT_CLOSED' });
  });
});

describe('acceso de los residentes', () => {
  test('un residente entra con el nombre que le da la casa, también para leer un chat ya cerrado', async () => {
    const visit = await ring();
    await renameResident(database, owner, { homeId: HOME, email: owner.email, name: 'Guido M.' }, residents);
    const access = await residentChatAccess(database, owner, visit.id, { settings: SETTINGS, residents });
    expect(await verifyChatToken(access.token, SECRET)).toMatchObject({ role: 'resident', name: 'Guido M.', visitId: visit.id });
    await age(visit.id, CHAT.windowSeconds + 1);
    await expect(residentChatAccess(database, owner, visit.id, { settings: SETTINGS, residents })).resolves.toHaveProperty('token');
  });

  test('quien no es residente de esa casa no abre su chat', async () => {
    const visit = await ring();
    await expect(residentChatAccess(database, stranger, visit.id, { settings: SETTINGS, residents })).rejects.toMatchObject({ status: 403 });
    await expect(residentChatAccess(database, owner, crypto.randomUUID(), { settings: SETTINGS, residents })).rejects.toMatchObject({ code: 'VISIT_NOT_FOUND' });
  });
});

describe('avisos del Worker', () => {
  test('un aviso firmado de una visita abierta notifica a los celulares de la casa con la política del chat', async () => {
    const visit = await ring();
    await addResident(database, owner, { homeId: HOME, email: stranger.email }, residents);
    await saveDevice(database, { homeId: HOME, name: 'Celu de Guido', subscription: pushSubscription('chat-device') }, owner, residents);
    const request = await signed({ visitId: visit.id, messageId: crypto.randomUUID(), body: 'Estoy en la puerta' });
    const outcome = await withProvider(async () => {
      const push = nock(PUSH_SERVICE).matchHeader('ttl', String(PUSH_POLICIES.chat.ttlSeconds)).matchHeader('urgency', 'high').post('/chat-device').reply(201);
      const result = await notifyChatMessage(database, request, { settings: SETTINGS });
      expect(push.isDone()).toBe(true);
      return result;
    });
    expect(outcome).toEqual({ delivery: 'sent' });
  });

  test('rechaza firmas inválidas o viejas, visitas desconocidas y chats cerrados sin notificar', async () => {
    const visit = await ring();
    const payload = { visitId: visit.id, messageId: crypto.randomUUID(), body: 'Hola' };
    const now = Math.floor(Date.now() / TIME.secondMs);
    await expect(notifyChatMessage(database, await signed(payload, now, 'otro-secreto-cualquiera-de-32-caracteres'), { settings: SETTINGS })).rejects.toMatchObject({ code: 'CHAT_SIGNATURE' });
    await expect(notifyChatMessage(database, await signed(payload, now - CHAT.webhookToleranceSeconds - 1), { settings: SETTINGS })).rejects.toMatchObject({ code: 'CHAT_SIGNATURE' });
    const valid = await signed(payload);
    await expect(notifyChatMessage(database, { ...valid, body: valid.body.replace('Hola', 'Chau') }, { settings: SETTINGS })).rejects.toMatchObject({ code: 'CHAT_SIGNATURE' });
    await expect(notifyChatMessage(database, { ...valid, signature: null }, { settings: SETTINGS })).rejects.toMatchObject({ code: 'CHAT_SIGNATURE' });
    await expect(notifyChatMessage(database, await signed({ ...payload, visitId: crypto.randomUUID() }), { settings: SETTINGS })).rejects.toMatchObject({ code: 'VISIT_NOT_FOUND' });
    await age(visit.id, CHAT.windowSeconds + 1);
    await expect(notifyChatMessage(database, await signed(payload), { settings: SETTINGS })).rejects.toMatchObject({ code: 'CHAT_CLOSED' });
  });
});
