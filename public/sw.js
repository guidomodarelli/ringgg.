/* Only the offline fallback is cached. Resident pages and API data remain private and fresh. */
const OFFLINE_CACHE = 'ringgg-offline-v1';
const ICON = '/icons/icon-192.png';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((cache) => cache.add('/offline.html')).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('ringgg-offline-') && key !== OFFLINE_CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
});

/** Notifications only ever open the dashboard of this origin. */
function dashboardUrl(value) {
  try {
    const url = new URL(value || '/', self.location.origin);
    return url.origin === self.location.origin && url.pathname === '/' ? `${url.pathname}${url.search}` : '/';
  } catch { return '/'; }
}

/** Tells open dashboards to refresh now instead of waiting for the next poll. */
function notifyClients(message) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => clients.forEach((client) => client.postMessage(message)));
}

async function openDashboard(url) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = clients.find((client) => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname === '/');
  if (!existing) return self.clients.openWindow(url);
  // Focus first: browsers only allow it while handling the click.
  const focused = await existing.focus();
  existing.postMessage({ type: 'ringgg:open', url });
  return focused;
}

self.addEventListener('push', (event) => {
  let data = { title: 'Hay alguien en la puerta', body: 'Abrí Ringgg para ver tu timbre.', tag: 'ringgg', url: '/', visitId: undefined, replies: [] };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch { /* A malformed payload still shows a safe notification. */ }
  const replies = Array.isArray(data.replies) ? data.replies.filter((item) => item && typeof item.reply === 'string' && typeof item.title === 'string').slice(0, 2) : [];
  event.waitUntil(Promise.all([
    self.registration.showNotification(data.title, {
      body: data.body, icon: ICON, badge: ICON, tag: data.tag,
      actions: data.visitId ? replies.map((item) => ({ action: `reply:${item.reply}`, title: item.title })) : [],
      data: { url: dashboardUrl(data.url), visitId: typeof data.visitId === 'string' ? data.visitId : undefined },
    }),
    notifyClients({ type: 'ringgg:push', visitId: data.visitId }),
  ]));
});

/** Answers from the notification with the resident's session; on any failure, opens the visit instead. */
async function answerFromNotification(visitId, reply, url, title) {
  try {
    const response = await fetch('/api/answer', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: visitId, reply }) });
    if (!response.ok) return openDashboard(url);
    await notifyClients({ type: 'ringgg:push', visitId });
    return self.registration.showNotification('Respuesta enviada', { body: `Le avisamos a tu visita: «${title}».`, icon: ICON, badge: ICON, tag: visitId, data: { url } });
  } catch { return openDashboard(url); }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url = '/', visitId } = event.notification.data || {};
  if (visitId && event.action && event.action.startsWith('reply:')) {
    const reply = event.action.slice('reply:'.length);
    const title = (event.notification.actions || []).find((item) => item.action === event.action)?.title || 'Respuesta enviada';
    event.waitUntil(answerFromNotification(visitId, reply, url, title));
    return;
  }
  event.waitUntil(openDashboard(dashboardUrl(url)));
});
