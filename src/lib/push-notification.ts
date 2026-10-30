/**
 * Pure helpers shared by the service worker and its tests. They only use language features, so the
 * worker bundle and Node tests run the same code. Imports stay relative for the worker build.
 */
import { VISIT_REPLY_KEYS } from '../constants/doorbell';

export interface NotificationReply { reply: string; title: string }
export interface PushData { kind: string; title: string; body: string; tag: string; url: string; visitId?: string; replies: NotificationReply[] }
export interface NotificationAction { action: string; title: string }

const REPLY_ACTION_PREFIX = 'reply:';
/** Platforms show at most two notification actions. */
const MAX_NOTIFICATION_ACTIONS = 2;
const FALLBACK: PushData = { kind: 'ring', title: 'Hay alguien en la puerta', body: 'Abrí Ringgg para ver tu timbre.', tag: 'ringgg', url: '/', replies: [] };

function text(value: unknown, fallback: string) {
  return typeof value === 'string' && value ? value : fallback;
}

/** Reads a push payload; a malformed one still shows a safe notification. */
export function parsePushData(raw: unknown): PushData {
  if (typeof raw !== 'object' || raw === null) return FALLBACK;
  const value = raw as Record<string, unknown>;
  const replies = Array.isArray(value.replies)
    ? value.replies.filter((item): item is NotificationReply => typeof item === 'object' && item !== null && typeof (item as NotificationReply).reply === 'string' && typeof (item as NotificationReply).title === 'string')
    : [];
  return {
    kind: text(value.kind, FALLBACK.kind),
    title: text(value.title, FALLBACK.title),
    body: text(value.body, FALLBACK.body),
    tag: text(value.tag, FALLBACK.tag),
    url: text(value.url, FALLBACK.url),
    visitId: typeof value.visitId === 'string' && value.visitId ? value.visitId : undefined,
    replies,
  };
}

/** Notifications only ever open the dashboard of this origin. */
export function dashboardUrl(value: unknown, origin: string) {
  try {
    const url = new URL(typeof value === 'string' && value ? value : '/', origin);
    return url.origin === origin && url.pathname === '/' ? `${url.pathname}${url.search}` : '/';
  } catch { return '/'; }
}

/** Reply buttons only belong to a visit, and only for replies the server accepts. */
export function notificationActions(data: PushData): NotificationAction[] {
  if (!data.visitId) return [];
  return data.replies
    .filter((item) => (VISIT_REPLY_KEYS as readonly string[]).includes(item.reply))
    .slice(0, MAX_NOTIFICATION_ACTIONS)
    .map((item) => ({ action: `${REPLY_ACTION_PREFIX}${item.reply}`, title: item.title }));
}

/** The reply a notification action stands for, or `null` for a plain click. */
export function replyFromAction(action: string) {
  return action.startsWith(REPLY_ACTION_PREFIX) ? action.slice(REPLY_ACTION_PREFIX.length) : null;
}

/** Body of the receipt the worker sends once a push reached this device. */
export function receiptBody(endpoint: string, visitId: string | undefined) {
  return { endpoint, visitId: visitId ?? null };
}

/** Body of the renewal the worker sends when the browser replaces the push subscription. */
export function renewalBody(subscription: unknown, previousEndpoint: string) {
  return { subscription, previousEndpoint };
}
