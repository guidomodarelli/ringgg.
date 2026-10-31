/**
 * Chat contract shared by the app server, the browser and the Cloudflare Worker: signed tokens, signed
 * notification requests and the messages each side sends over the socket. It only uses web platform
 * APIs (Web Crypto, `TextEncoder`, `btoa`), so the three runtimes run the same code. Imports stay
 * relative for the Worker build.
 */
import { CHAT, CHAT_PATHS, CHAT_REJECTIONS, type ChatRejection } from '../constants/chat';
import { TIME } from '../constants/time';

/** Who holds a socket: the visitor who rang, or a resident of the home. */
export type ChatRole = 'visitor' | 'resident';

/** What a chat token grants: one visit's room, as its visitor or as a named resident, until `expiresAt`. */
export interface ChatClaims {
  visitId: string;
  role: ChatRole;
  /** How the room shows a resident to the other residents; always `null` for the visitor. */
  name: string | null;
  /** The app that issued it: it names the room and receives its notifications, the same for every page of the deployment. */
  origin: string;
  /**
   * The page that opens the socket, one of the app's allowed origins (a preview answers on its branch
   * URL and on its deployment URL). The Worker only accepts sockets from it.
   */
  pageOrigin: string;
  /** When the visit stops taking messages, in epoch milliseconds. */
  closesAt: number;
  /** When the token stops opening sockets, in epoch milliseconds. */
  expiresAt: number;
}

/**
 * A message as one reader receives it. The visitor never learns who answered: for them a resident's
 * message comes with `name: null` and the page shows the home's name instead.
 */
export interface ChatMessage { id: string; author: ChatRole; name: string | null; body: string; sentAt: number }

/** The only thing a client sends: a message with the id it chose, so a retry never posts it twice. */
export interface ClientChatMessage { type: 'send'; id: string; body: string }

export type ServerChatMessage =
  | { type: 'history'; messages: ChatMessage[]; closesAt: number }
  | { type: 'message'; message: ChatMessage }
  | { type: 'rejected'; id: string; code: ChatRejection };

/**
 * What a browser needs to open a visit's chat: the room's socket URL, a short-lived token, when the
 * chat closes, and who the token speaks for, so the page can tell its own messages apart.
 */
export interface ChatAccess { url: string; token: string; closesAt: number; role: ChatRole; name: string | null }

/** What the Worker tells the app when the visitor writes and no resident has the chat open. */
export interface ChatNotification { visitId: string; messageId: string; body: string }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HMAC = { name: 'HMAC', hash: 'SHA-256' };

function encodeBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  // Padding only ever appears at the end, so dropping every `=` is the same as trimming it.
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** `null` when the text is not base64url, so a malformed token is rejected instead of throwing. */
function decodeBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
    return Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
  } catch { return null; }
}

function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), HMAC, false, ['sign', 'verify']);
}

async function sign(text: string, secret: string) {
  return encodeBase64Url(new Uint8Array(await crypto.subtle.sign(HMAC, await hmacKey(secret), encoder.encode(text))));
}

/** Web Crypto compares the signatures in constant time. */
async function verify(text: string, signature: string, secret: string) {
  const bytes = decodeBase64Url(signature);
  return bytes !== null && crypto.subtle.verify(HMAC, await hmacKey(secret), bytes, encoder.encode(text));
}

export function isVisitId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isChatClaims(value: unknown): value is ChatClaims {
  if (typeof value !== 'object' || value === null) return false;
  const claims = value as Record<string, unknown>;
  return isVisitId(claims.visitId) && (claims.role === 'visitor' || claims.role === 'resident')
    && (claims.name === null || typeof claims.name === 'string') && typeof claims.origin === 'string' && typeof claims.pageOrigin === 'string'
    && typeof claims.closesAt === 'number' && typeof claims.expiresAt === 'number';
}

/** `<payload>.<signature>`, both base64url, so it fits in a `Sec-WebSocket-Protocol` header. */
export async function signChatToken(claims: ChatClaims, secret: string) {
  const payload = encodeBase64Url(encoder.encode(JSON.stringify(claims)));
  return `${payload}.${await sign(payload, secret)}`;
}

/** The claims of a token this secret signed and that has not expired, or `null`. */
export async function verifyChatToken(token: string, secret: string, now = Date.now()): Promise<ChatClaims | null> {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined || !(await verify(payload, signature, secret))) return null;
  const bytes = decodeBase64Url(payload);
  if (!bytes) return null;
  let claims: unknown;
  try { claims = JSON.parse(decoder.decode(bytes)); } catch { return null; }
  return isChatClaims(claims) && claims.expiresAt > now ? claims : null;
}

/** The subprotocols a browser offers: the chat protocol first, then the token the server reads. */
export function chatSocketProtocols(token: string) {
  return [CHAT.protocol, token];
}

/** The token offered next to the chat protocol in a `Sec-WebSocket-Protocol` header, or `null`. */
export function tokenFromProtocols(header: string | null) {
  const [protocol, token, extra] = (header ?? '').split(',').map((value) => value.trim());
  return protocol === CHAT.protocol && token && extra === undefined ? token : null;
}

/** One room per visit and per app: a preview and production never share a room. */
export function chatRoomName(origin: string, visitId: string) {
  return `${origin} ${visitId}`;
}

/** The socket URL of a visit's room, from the Worker's base URL (`wss://…` or `ws://…` locally). */
export function chatSocketUrl(baseUrl: string, visitId: string) {
  return `${baseUrl.replace(/\/$/, '')}${CHAT_PATHS.socket}${encodeURIComponent(visitId)}`;
}

/** Signature of a notification request: it covers the body and the time it was sent. */
export function signNotification(body: string, timestampSeconds: number, secret: string) {
  return sign(`${timestampSeconds}.${body}`, secret);
}

/** A notification request as received: the exact body and its two headers, which may be missing. */
export interface SignedChatNotification { body: string; timestamp: string | null; signature: string | null }

/** A request the Worker signed recently enough; an old one is rejected even with a valid signature. */
export async function verifyNotification({ body, timestamp, signature }: SignedChatNotification, secret: string, now = Date.now()) {
  const seconds = Number(timestamp);
  if (!timestamp || !signature || !Number.isInteger(seconds)) return false;
  if (Math.abs(now / TIME.secondMs - seconds) > CHAT.webhookToleranceSeconds) return false;
  return verify(`${seconds}.${body}`, signature, secret);
}

/** A message from a socket, or `null` when it is not a valid one. The body is sent without surrounding spaces. */
export function parseClientChatMessage(raw: string): ClientChatMessage | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (typeof value !== 'object' || value === null) return null;
  const message = value as Record<string, unknown>;
  if (message.type !== 'send' || !isVisitId(message.id) || typeof message.body !== 'string') return null;
  const body = message.body.trim();
  return body && body.length <= CHAT.messageMaxLength ? { type: 'send', id: message.id, body } : null;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  return typeof message.id === 'string' && (message.author === 'visitor' || message.author === 'resident')
    && (message.name === null || typeof message.name === 'string') && typeof message.body === 'string' && typeof message.sentAt === 'number';
}

/** What the room sent, or `null` for anything this client does not understand. */
export function parseServerChatMessage(raw: unknown): ServerChatMessage | null {
  if (typeof raw !== 'string') return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (typeof value !== 'object' || value === null) return null;
  const message = value as Record<string, unknown>;
  if (message.type === 'history' && Array.isArray(message.messages) && message.messages.every(isChatMessage) && typeof message.closesAt === 'number') return { type: 'history', messages: message.messages, closesAt: message.closesAt };
  if (message.type === 'message' && isChatMessage(message.message)) return { type: 'message', message: message.message };
  if (message.type === 'rejected' && typeof message.id === 'string' && typeof message.code === 'string' && Object.hasOwn(CHAT_REJECTIONS, message.code)) return { type: 'rejected', id: message.id, code: message.code as ChatRejection };
  return null;
}

/** The message as `role` reads it: the visitor gets residents' messages without their names. */
export function messageFor(message: ChatMessage, role: ChatRole): ChatMessage {
  return role === 'visitor' && message.author === 'resident' ? { ...message, name: null } : message;
}
