/* Only the offline fallback is cached. Resident pages and API data remain private and fresh. */
const OFFLINE_CACHE = 'ringgg-offline-v1';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((cache) => cache.add('/offline.html')).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('ringgg-offline-') && key !== OFFLINE_CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
});
self.addEventListener('push', (event) => {
  let data = { title: 'Hay alguien en la puerta', body: 'Abrí Ringgg para ver tu timbre.', tag: 'ringgg' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch { /* A malformed payload still shows a safe notification. */ }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: data.tag, data: { url: '/' } }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname === '/');
    if (existing) return existing.focus();
    return self.clients.openWindow('/');
  }));
});
