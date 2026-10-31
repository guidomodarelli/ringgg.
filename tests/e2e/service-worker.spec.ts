import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { WORKER_PATH, attachWorkerDevtools, shownNotifications, workerMessages } from './support/service-worker-devtools';

// The headless shell cannot grant the notifications permission; full Chromium in new headless mode can.
test.use({ channel: 'chromium' });

/** Serves the real worker and an empty page that registers it, on a secure loopback origin. */
async function startWorkerServer() {
  const server = createServer((request, response) => {
    if (request.url === '/sw.js') { response.setHeader('Content-Type', 'text/javascript'); response.setHeader('Service-Worker-Allowed', '/'); response.end(readFileSync(WORKER_PATH)); return; }
    if (request.url === '/offline.html') { response.setHeader('Content-Type', 'text/html'); response.end(readFileSync('public/offline.html')); return; }
    if (request.url?.startsWith('/icons/')) { response.setHeader('Content-Type', 'image/png'); response.end(readFileSync('public/icons/icon-192.png')); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html lang="es"><meta charset="utf-8"><body><script>window.workerMessages = []; navigator.serviceWorker.addEventListener("message", (event) => window.workerMessages.push(event.data)); navigator.serviceWorker.register("/sw.js");</script></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

// Every read of the notifications waits for the worker's message: one that runs while Chromium is still
// showing the notification can drop it from the list for good (the push did arrive, the list says `[]`).

test('un timbrazo muestra respuestas y una nota posterior reemplaza el aviso sonando de nuevo', async ({ browser }) => {
  test.skip(!existsSync(WORKER_PATH), 'Requiere el service worker generado por npm run build:sw.');
  const { server, origin } = await startWorkerServer();
  const context = await browser.newContext();
  try {
    await context.grantPermissions(['notifications'], { origin });
    const page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const devtools = await attachWorkerDevtools(context, page, origin);
    const visitId = '0d9c2f5e-3f0a-4c49-9d5b-7f3e2a1b4c6d';
    await devtools.deliverPush({ kind: 'ring', title: 'Hay alguien en la puerta', body: 'Soy Juan', tag: visitId, visitId, url: `/?view=history&visit=${visitId}`, replies: [{ reply: 'coming', title: 'Ya voy' }, { reply: 'leave', title: 'Dejalo en la puerta' }] });
    await expect.poll(() => workerMessages(page)).toEqual([{ type: 'ringgg:push', visitId }]);
    expect(await shownNotifications(page)).toEqual([{ title: 'Hay alguien en la puerta', body: 'Soy Juan', tag: visitId, renotify: true, actions: ['reply:coming', 'reply:leave'], data: { url: `/?view=history&visit=${visitId}`, visitId } }]);

    await devtools.deliverPush({ kind: 'note', title: 'Te dejaron un mensaje', body: 'Llamame al 11 5555 5555', tag: visitId, visitId, url: `/?view=history&visit=${visitId}`, replies: [] });
    await expect.poll(() => workerMessages(page)).toEqual([{ type: 'ringgg:push', visitId }, { type: 'ringgg:push', visitId }]);
    expect(await shownNotifications(page)).toEqual([{ title: 'Te dejaron un mensaje', body: 'Llamame al 11 5555 5555', tag: visitId, renotify: true, actions: [], data: { url: `/?view=history&visit=${visitId}`, visitId } }]);
  } finally {
    await context.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('un payload ajeno nunca abre otro origen desde la notificación', async ({ browser }) => {
  test.skip(!existsSync(WORKER_PATH), 'Requiere el service worker generado por npm run build:sw.');
  const { server, origin } = await startWorkerServer();
  const context = await browser.newContext();
  try {
    await context.grantPermissions(['notifications'], { origin });
    const page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const devtools = await attachWorkerDevtools(context, page, origin);
    await devtools.deliverPush({ kind: 'test', title: 'Prueba', body: 'Prueba', tag: 'test-tag', url: 'https://evil.example/robar', replies: [{ reply: 'coming', title: 'Ya voy' }] });
    await expect.poll(() => workerMessages(page)).toEqual([{ type: 'ringgg:push' }]);
    expect(await shownNotifications(page)).toEqual([{ title: 'Prueba', body: 'Prueba', tag: 'test-tag', renotify: true, actions: [], data: { url: '/' } }]);
  } finally {
    await context.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
