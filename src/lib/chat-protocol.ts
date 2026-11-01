/**
 * Chat contract shared by the app server, the browser and the Cloudflare Worker: signed tokens, signed
 * requests between the app and the Worker (notifications and answers) and the messages each side sends
 * over the socket. It only uses web platform APIs (Web Crypto, `TextEncoder`, `btoa`), so the three
 * runtimes run the same code. Imports stay relative for the Worker build.
 */
import { CHAT, CHAT_PATHS, CHAT_REJECTIONS, type ChatRejection } from '../constants/chat';
import { VISIT_REPLIES, type VisitReply } from '../constants/doorbell';
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

/** The residents' quick reply to the ring («Ya voy», «No estoy»…), as every socket receives it: never who sent it. */
export interface ChatAnswer { reply: VisitReply; answeredAt: string }

/**
 * What the app tells a visit's room when the residents answer the ring. It also opens the room, which may
 * have no socket yet, so it says which app it belongs to and when it closes, like a token does.
 */
export interface ChatAnswerAnnouncement { visitId: string; origin: string; closesAt: number; answer: ChatAnswer }

/**
 * `history` comes first on every socket, with the answer if the residents already gave it; `answer`
 * reaches the sockets that are open when they do.
 */
export type ServerChatMessage =
  | { type: 'history'; messages: ChatMessage[]; closesAt: number; answer: ChatAnswer | null }
  | { type: 'message'; message: ChatMessage }
  | { type: 'answer'; answer: ChatAnswer }
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

/** Where the app announces a visit's answer: the same Worker over HTTP (`https://…`, or `http://…` locally). */
export function chatAnswerUrl(baseUrl: string, visitId: string) {
  return `${chatSocketUrl(baseUrl, visitId).replace(/^ws/, 'http')}${CHAT_PATHS.answer}`;
}

/**
 * Signed text of an answer announcement. Its prefix sets it apart from a notification, whose text starts
 * with the timestamp: one request's signature never passes for the other.
 */
const ANSWER_SIGNATURE_PREFIX = 'answer.';

/** A signed request as received: the exact body and its two headers, which may be missing. */
export interface SignedChatRequest { body: string; timestamp: string | null; signature: string | null }

/** A request signed with this prefix recently enough; an old one is rejected even with a valid signature. */
async function verifySignedRequest(prefix: string, { body, timestamp, signature }: SignedChatRequest, secret: string, now: number) {
  const seconds = Number(timestamp);
  if (!timestamp || !signature || !Number.isInteger(seconds)) return false;
  if (Math.abs(now / TIME.secondMs - seconds) > CHAT.webhookToleranceSeconds) return false;
  return verify(`${prefix}${seconds}.${body}`, signature, secret);
}

/** Signature of a notification request: it covers the body and the time it was sent. */
export function signNotification(body: string, timestampSeconds: number, secret: string) {
  return sign(`${timestampSeconds}.${body}`, secret);
}

/** A notification the Worker signed recently enough. */
export function verifyNotification(request: SignedChatRequest, secret: string, now = Date.now()) {
  return verifySignedRequest('', request, secret, now);
}

/** Signature of an answer announcement: it covers the body and the time it was sent, like a notification. */
export function signAnswerAnnouncement(body: string, timestampSeconds: number, secret: string) {
  return sign(`${ANSWER_SIGNATURE_PREFIX}${timestampSeconds}.${body}`, secret);
}

/** An answer announcement the app signed recently enough. */
export function verifyAnswerAnnouncement(request: SignedChatRequest, secret: string, now = Date.now()) {
  return verifySignedRequest(ANSWER_SIGNATURE_PREFIX, request, secret, now);
}

function isChatAnswer(value: unknown): value is ChatAnswer {
  if (typeof value !== 'object' || value === null) return false;
  const answer = value as Record<string, unknown>;
  return typeof answer.reply === 'string' && Object.hasOwn(VISIT_REPLIES, answer.reply)
    && typeof answer.answeredAt === 'string' && !Number.isNaN(Date.parse(answer.answeredAt));
}

/** An announcement's body, or `null` when it is not a valid one. */
export function parseAnswerAnnouncement(raw: string): ChatAnswerAnnouncement | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (typeof value !== 'object' || value === null) return null;
  const announcement = value as Record<string, unknown>;
  if (!isVisitId(announcement.visitId) || typeof announcement.origin !== 'string' || typeof announcement.closesAt !== 'number' || !isChatAnswer(announcement.answer)) return null;
  const { reply, answeredAt } = announcement.answer;
  return { visitId: announcement.visitId, origin: announcement.origin, closesAt: announcement.closesAt, answer: { reply, answeredAt } };
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
  // A room deployed before answers existed sends its history without one.
  if (message.type === 'history' && Array.isArray(message.messages) && message.messages.every(isChatMessage) && typeof message.closesAt === 'number') return { type: 'history', messages: message.messages, closesAt: message.closesAt, answer: isChatAnswer(message.answer) ? message.answer : null };
  if (message.type === 'message' && isChatMessage(message.message)) return { type: 'message', message: message.message };
  if (message.type === 'answer' && isChatAnswer(message.answer)) return { type: 'answer', answer: message.answer };
  if (message.type === 'rejected' && typeof message.id === 'string' && typeof message.code === 'string' && Object.hasOwn(CHAT_REJECTIONS, message.code)) return { type: 'rejected', id: message.id, code: message.code as ChatRejection };
  return null;
}

/** The message as `role` reads it: the visitor gets residents' messages without their names. */
export function messageFor(message: ChatMessage, role: ChatRole): ChatMessage {
  return role === 'visitor' && message.author === 'resident' ? { ...message, name: null } : message;
}
