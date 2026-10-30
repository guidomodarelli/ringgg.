/// <reference lib="webworker" />
/* Only the offline fallback is cached. Resident pages and API data remain private and fresh. */
import { WORKER_MESSAGES } from '../constants/push';
import { dashboardUrl, notificationActions, parsePushData, receiptBody, renewalBody, replyFromAction, type PushData } from '../lib/push-notification';

declare const self: ServiceWorkerGlobalScope;

const OFFLINE_CACHE = 'ringgg-offline-v2';
const OFFLINE_PAGE = '/offline.html';
/** Small worker state that must survive restarts, such as the last push endpoint it saw. */
const STATE_CACHE = 'ringgg-state-v1';
const ENDPOINT_KEY = '/__ringgg/push-endpoint';
const ICON = '/icons/icon-192.png';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Fields the platforms support beyond the typed `NotificationOptions`. */
interface DoorbellNotificationOptions extends NotificationOptions { actions?: Array<{ action: string; title: string }>; renotify?: boolean }
/** `pushsubscriptionchange` is not in the TypeScript worker library; browsers that fire it may include both subscriptions. */
interface SubscriptionChangeEvent extends ExtendableEvent { oldSubscription?: PushSubscription | null; newSubscription?: PushSubscription | null }

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((cache) => cache.add(OFFLINE_PAGE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith('ringgg-offline-') && key !== OFFLINE_CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(async () => (await caches.match(OFFLINE_PAGE)) ?? Response.error()));
});

async function rememberEndpoint(endpoint: string) {
  await (await caches.open(STATE_CACHE)).put(ENDPOINT_KEY, new Response(endpoint));
}

async function rememberedEndpoint() {
  const stored = await (await caches.open(STATE_CACHE)).match(ENDPOINT_KEY);
  return stored ? stored.text() : null;
}

/** Tells open dashboards to refresh now instead of waiting for the next poll. */
async function notifyClients(message: { type: string; visitId?: string; url?: string }) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

async function openDashboard(url: string) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = clients.find((client) => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname === '/');
  if (!existing) return self.clients.openWindow(url);
  // Focus first: browsers only allow it while handling the click.
  const focused = await existing.focus();
  existing.postMessage({ type: WORKER_MESSAGES.open, url });
  return focused;
}

/**
 * Confirms to the server that this device received the push, with the resident's cookies. A missing
 * receipt only means the panel cannot confirm this device: the notification is already on screen.
 */
async function confirmReceipt(visitId: string | undefined) {
  try {
    const subscription = await self.registration.pushManager.getSubscription();
    if (!subscription) return;
    await rememberEndpoint(subscription.endpoint);
    await fetch('/api/push-receipt', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(receiptBody(subscription.endpoint, visitId)) });
  } catch { /* The receipt is best effort; the next push tries again. */ }
}

function readPayload(event: PushEvent): unknown {
  try { return event.data?.json(); } catch { return null; }
}

self.addEventListener('push', (event) => {
  const data: PushData = parsePushData(readPayload(event));
  // `renotify`: a new event for the same visit (for example a note after an unanswered ring) replaces
  // the previous notification and still sounds and vibrates.
  const options: DoorbellNotificationOptions = {
    body: data.body, icon: ICON, badge: ICON, tag: data.tag, renotify: true,
    actions: notificationActions(data),
    data: { url: dashboardUrl(data.url, self.location.origin), visitId: data.visitId },
  };
  event.waitUntil(Promise.all([
    self.registration.showNotification(data.title, options),
    notifyClients({ type: WORKER_MESSAGES.push, visitId: data.visitId }),
    confirmReceipt(data.visitId),
  ]));
});

/**
 * The browser replaced or dropped the subscription: subscribe again and update the same device on
 * the server, so this phone keeps ringing for all its homes without anyone opening the panel.
 */
async function renewSubscription(event: SubscriptionChangeEvent) {
  const previousEndpoint = event.oldSubscription?.endpoint ?? await rememberedEndpoint();
  // Without the old endpoint there is no device to update: the panel offers to connect this one again.
  if (!previousEndpoint) return;
  let subscription = event.newSubscription ?? null;
  if (!subscription) {
    const keyResponse = await fetch('/api/push-key');
    if (!keyResponse.ok) return;
    const { publicKey } = await keyResponse.json() as { publicKey: string };
    subscription = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
  }
  const response = await fetch('/api/renew-subscription', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(renewalBody(subscription.toJSON(), previousEndpoint)) });
  if (response.ok) await rememberEndpoint(subscription.endpoint);
}

self.addEventListener('pushsubscriptionchange', (event) => {
  const change = event as SubscriptionChangeEvent;
  // Without a valid session the panel detects the unregistered device and asks to enable notifications again.
  change.waitUntil(renewSubscription(change).catch(() => undefined));
});

/** The visit the server stored after an answer; only the first answer reaches the visitor. */
interface StoredAnswer { reply?: unknown; answered_by?: unknown }

/**
 * Sends the answer with the resident's session and tells open dashboards. Resolves the stored visit
 * (`stored` is `null` when its body is unreadable), or `null` when the answer did not go through.
 */
async function sendAnswer(visitId: string, reply: string): Promise<{ stored: StoredAnswer | null } | null> {
  try {
    const response = await fetch('/api/answer', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id: visitId, reply }) });
    if (!response.ok) return null;
    const stored = await response.json().catch(() => null) as StoredAnswer | null;
    await notifyClients({ type: WORKER_MESSAGES.push, visitId });
    return { stored };
  } catch { return null; }
}

/** Answers from the notification with the resident's session; on any failure, opens the visit instead. */
async function answerFromNotification(visitId: string, reply: string, url: string, title: string) {
  const answer = await sendAnswer(visitId, reply);
  if (!answer) return openDashboard(url);
  // Confirm what was stored, not what was tapped.
  const { stored } = answer;
  if (stored && typeof stored.reply === 'string' && stored.reply !== reply) {
    const who = typeof stored.answered_by === 'string' && stored.answered_by ? `${stored.answered_by} ya había respondido` : 'Alguien ya había respondido';
    return self.registration.showNotification('Ya respondieron', { body: `${who}: tu visita ve otra respuesta.`, icon: ICON, badge: ICON, tag: visitId, data: { url } });
  }
  return self.registration.showNotification('Respuesta enviada', { body: `Le avisamos a tu visita: «${title}».`, icon: ICON, badge: ICON, tag: visitId, data: { url } });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url = '/', visitId } = (event.notification.data ?? {}) as { url?: string; visitId?: string };
  const reply = replyFromAction(event.action);
  if (visitId && reply) {
    const actions = (event.notification as Notification & { actions?: Array<{ action: string; title: string }> }).actions ?? [];
    const title = actions.find((item) => item.action === event.action)?.title ?? 'Respuesta enviada';
    event.waitUntil(answerFromNotification(visitId, reply, url, title));
    return;
  }
  event.waitUntil(openDashboard(dashboardUrl(url, self.location.origin)));
});
