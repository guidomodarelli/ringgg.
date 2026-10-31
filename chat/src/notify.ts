import { CHAT, CHAT_HEADERS, CHAT_PATHS } from '../../src/constants/chat';
import { TIME } from '../../src/constants/time';
import { signNotification, type ChatMessage, type ChatNotification } from '../../src/lib/chat-protocol';
import type { RoomState } from './room-store';

/** One JSON line per failure, with the visit and never the message, so logs hold no visitor text. */
function logNotifyFailure(room: RoomState, details: Record<string, unknown>) {
  console.error(JSON.stringify({ level: 'error', operation: 'ChatRoom:notifyResidents', visitId: room.visitId, method: 'POST', path: CHAT_PATHS.notify, ...details }));
}

/**
 * Asks the app that issued the room's tokens to notify the residents. The request is signed with the
 * shared secret and its timestamp, so the app can reject forged and replayed requests. A failure is
 * logged and dropped: the message is already in the room, and the next one can notify again.
 */
export async function notifyResidents(room: RoomState, message: ChatMessage, secret: string) {
  const body = JSON.stringify({ visitId: room.visitId, messageId: message.id, body: message.body } satisfies ChatNotification);
  const timestamp = Math.floor(Date.now() / TIME.secondMs);
  try {
    const response = await fetch(`${room.origin}${CHAT_PATHS.notify}`, {
      method: 'POST', body, signal: AbortSignal.timeout(CHAT.notifyTimeoutMs),
      headers: { 'Content-Type': 'application/json', [CHAT_HEADERS.timestamp]: String(timestamp), [CHAT_HEADERS.signature]: await signNotification(body, timestamp, secret) },
    });
    if (!response.ok) logNotifyFailure(room, { status: response.status, requestId: response.headers.get('x-request-id') });
  } catch (error) {
    logNotifyFailure(room, { error: error instanceof Error ? { name: error.name, message: error.message } : String(error) });
  }
}
