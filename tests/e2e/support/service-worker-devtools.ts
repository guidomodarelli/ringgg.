import { expect, type BrowserContext, type Page, type Response, type Worker } from '@playwright/test';

/** Path of the generated worker, which `npm run build:sw` writes before the Playwright web server starts. */
export const WORKER_PATH = 'public/sw.js';

/** The worker's side of the DevTools protocol for one page: pushes it delivers and errors the worker reports. */
export interface WorkerDevtools {
  /** Delivers a push the same way as the "Push" button of Chrome DevTools. */
  deliverPush: (payload: unknown) => Promise<void>;
  /** Uncaught errors of the worker, such as a window Chromium did not let it focus or open. */
  errors: string[];
  /** The running worker, started again if the browser stopped it while idle. */
  worker: () => Promise<Worker>;
}

function isAppWorker(worker: Worker) {
  return new URL(worker.url()).pathname === '/sw.js';
}

/** Attaches to the service worker registration of `origin`; the page waits until the worker is active. */
export async function attachWorkerDevtools(context: BrowserContext, page: Page, origin: string): Promise<WorkerDevtools> {
  await page.evaluate(() => navigator.serviceWorker.ready);
  const session = await context.newCDPSession(page);
  const errors: string[] = [];
  session.on('ServiceWorker.workerErrorReported', ({ errorMessage }) => { errors.push(errorMessage.errorMessage); });
  const registration = new Promise<{ registrationId: string; scopeURL: string }>((resolve) => {
    session.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      const match = registrations.find((item) => item.scopeURL.startsWith(origin) && !item.isDeleted);
      if (match) resolve(match);
    });
  });
  await session.send('ServiceWorker.enable');
  const { registrationId, scopeURL } = await registration;
  return {
    errors,
    deliverPush: async (payload) => { await session.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify(payload) }); },
    worker: async () => {
      await session.send('ServiceWorker.startWorker', { scopeURL });
      const running = () => context.serviceWorkers().find(isAppWorker);
      await expect.poll(() => Boolean(running())).toBe(true);
      const worker = running();
      if (!worker) throw new Error(`WorkerDevtools:worker failed: the worker of ${scopeURL} is not running`);
      return worker;
    },
  };
}

/**
 * The next response of the app's API at `path`, from a page or from the worker. Read its status, not its body:
 * the body of a worker's response cannot be read once the browser stops the worker while idle.
 */
export function nextApiResponse(context: BrowserContext, path: string): Promise<Response> {
  return context.waitForEvent('response', (response) => new URL(response.url()).pathname === path);
}

/** Init script that keeps what the worker posts to each page in `window.workerMessages`. */
export function recordWorkerMessages() {
  const messages: unknown[] = [];
  (window as unknown as { workerMessages: unknown[] }).workerMessages = messages;
  navigator.serviceWorker?.addEventListener('message', (event) => { messages.push(event.data); });
}

/** What the worker told this page. It sends it once the notification it shows settled. */
export async function workerMessages(page: Page) {
  return page.evaluate(() => (window as unknown as { workerMessages?: unknown[] }).workerMessages ?? []);
}

/**
 * The notifications on screen, or only the one of `tag`. Read only after the worker's message: Chromium
 * drops a notification from this list for good when it is read while the notification is still being shown.
 */
export async function shownNotifications(page: Page, tag?: string) {
  return page.evaluate(async (filter) => (await (await navigator.serviceWorker.ready).getNotifications(filter)).map((notification) => ({
    title: notification.title, body: notification.body, tag: notification.tag, renotify: (notification as Notification & { renotify?: boolean }).renotify,
    actions: ((notification as Notification & { actions?: Array<{ action: string; title: string }> }).actions ?? []).map((action) => action.action),
    data: notification.data as unknown,
  })), tag === undefined ? undefined : { tag });
}

/** The parts of the worker's global scope these tests use, which the DOM library does not type. */
interface WorkerScope {
  registration: ServiceWorkerRegistration;
  dispatchEvent: (event: Event) => boolean;
  NotificationEvent: new (type: string, init: { notification: Notification; action: string }) => Event;
  PushSubscriptionChangeEvent: new (type: string) => Event;
  clients: { matchAll: (options: { type: string; includeUncontrolled: boolean }) => Promise<Array<{ postMessage: (message: unknown) => void }>> };
}

/**
 * Taps the notification of `tag`, on `action` or on its body (`''`). The event is built by script, so Chromium
 * never lets the worker focus or open a window from it, and `waitUntil` throws once the handler started its work.
 */
export async function tapNotification(worker: Worker, tag: string, action: string) {
  await worker.evaluate(async ({ tapped, notificationTag }) => {
    const scope = self as unknown as WorkerScope;
    const [notification] = await scope.registration.getNotifications({ tag: notificationTag });
    if (!notification) throw new Error(`tapNotification failed: no notification with tag ${notificationTag} is on screen`);
    scope.dispatchEvent(new scope.NotificationEvent('notificationclick', { notification, action: tapped }));
  }, { tapped: action, notificationTag: tag });
}

/** The browser drops this subscription and reports it without the old or the new one: the worker only has the endpoint it remembered. */
export async function dropSubscription(worker: Worker) {
  await worker.evaluate(async () => {
    const scope = self as unknown as WorkerScope;
    await (await scope.registration.pushManager.getSubscription())?.unsubscribe();
    scope.dispatchEvent(new scope.PushSubscriptionChangeEvent('pushsubscriptionchange'));
  });
}

/** The endpoint of the browser's push subscription, or `null` without one. */
export async function subscriptionEndpoint(worker: Worker) {
  return worker.evaluate(async () => (await (self as unknown as WorkerScope).registration.pushManager.getSubscription())?.endpoint ?? null);
}

/** Posts `message` from the worker to the windows of its origin; the worker itself posts to the panel it focused. */
export async function postFromWorker(worker: Worker, message: unknown) {
  await worker.evaluate(async (posted) => {
    for (const client of await (self as unknown as WorkerScope).clients.matchAll({ type: 'window', includeUncontrolled: true })) client.postMessage(posted);
  }, message);
}
