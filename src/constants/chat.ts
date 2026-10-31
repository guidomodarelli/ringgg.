import { DOORBELL } from './doorbell';

/**
 * Chat between a visitor and the residents of the home they rang, served by the Cloudflare Worker in
 * `chat/`. Imports stay relative: the Worker bundles this file too.
 */
export const CHAT = {
  /** The chat replaces the visitor's note, so it accepts messages during the same window after the ring. */
  windowSeconds: DOORBELL.noteWindowSeconds,
  /** The room forgets its messages with the visit they belong to. */
  retentionDays: DOORBELL.retentionDays,
  messageMaxLength: 300,
  /** Messages one visit keeps: a full room rejects new ones, so a visitor cannot flood it. */
  roomMessageLimit: 100,
  /** A token only opens one socket; every reconnection asks the app for a new one. */
  tokenTtlSeconds: 120,
  /** At most one "the visitor wrote" notification per visit this often, and only while no resident has the chat open. */
  notifyCooldownSeconds: 60,
  /** A notification request signed further than this from the receiver's clock is rejected as a replay. */
  webhookToleranceSeconds: 300,
  notifyTimeoutMs: 8_000,
  /** WebSocket subprotocol. The token travels next to it in `Sec-WebSocket-Protocol`, never in the URL. */
  protocol: 'ringgg-chat',
  secretMinimumLength: 32,
  /** Characters of a message shown in its notification. */
  notificationBodyMaxLength: 160,
  reconnect: { initialDelayMs: 1_000, maxDelayMs: 15_000 },
  /** A sent message the room has not confirmed by then is marked as unconfirmed, with a retry that never duplicates it. */
  sendTimeoutMs: 10_000,
  /** How close to the end of the list counts as "reading the latest": new messages scroll into view only then. */
  scrollStickinessPx: 48,
};

export const CHAT_PATHS = {
  /** `wss://<worker>/visits/<visitId>` opens the room of one visit. */
  socket: '/visits/',
  health: '/health',
  /** Route of the app that the Worker calls when the visitor writes and nobody has the chat open. */
  notify: '/api/chat/notify',
};

/** Headers of the Worker's notification request: an HMAC of `<timestamp>.<body>` and that timestamp in seconds. */
export const CHAT_HEADERS = { signature: 'x-ringgg-signature', timestamp: 'x-ringgg-timestamp' };

/** Reasons the room gives when it does not take a message. */
export type ChatRejection = 'CHAT_CLOSED' | 'MESSAGE_INVALID' | 'ROOM_FULL';
export const CHAT_REJECTIONS = {
  CHAT_CLOSED: 'El chat de esta visita ya terminó.',
  MESSAGE_INVALID: `Escribí un mensaje de hasta ${CHAT.messageMaxLength} caracteres.`,
  ROOM_FULL: 'Este chat llegó al límite de mensajes.',
} as const satisfies Record<ChatRejection, string>;
