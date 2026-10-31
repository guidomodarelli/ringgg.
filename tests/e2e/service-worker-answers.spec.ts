import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { VISIT_REPLIES } from '../../src/constants/doorbell';
import { WORKER_MESSAGES } from '../../src/constants/push';
import { LIVE_RESIDENT, LIVE_RESIDENT_REQUIRED, createHome, deleteHome, homeSnapshot, onlyVisit, ringAsVisitor, ringPush, signInResident, type TestHome } from './support/resident-session';
import { attachWorkerDevtools, nextApiResponse, postFromWorker, recordWorkerMessages, shownNotifications, tapNotification, workerMessages } from './support/service-worker-devtools';

// The real worker of the running app answers with the real resident's session: Origin, cookies, the API's
// schema and its database. The headless shell cannot grant the notifications permission; full Chromium can.
// Incognito contexts cannot subscribe to push, which these answers do not need: DevTools delivers each push.
test.use({ channel: 'chromium' });
test.beforeEach(() => { test.skip(!LIVE_RESIDENT, LIVE_RESIDENT_REQUIRED); });

/** The resident on a home of their own with the app's worker active; every page records what the worker posts. */
async function openResidentHome(page: Page, context: BrowserContext, origin: string) {
  await context.grantPermissions(['notifications'], { origin });
  await context.addInitScript(recordWorkerMessages);
  await signInResident(page);
  const home = await createHome(page, origin);
  await page.goto(`/?home=${home.id}&view=history`);
  return { home, devtools: await attachWorkerDevtools(context, page, origin) };
}

/** The visit's row in the panel. */
function visitRow(page: Page, message: string) {
  return page.getByRole('article').filter({ hasText: message });
}

/** The link a notification of this visit opens: the history of its home, focused on it. */
function visitLink(home: TestHome, visitId: string) {
  return `/?home=${home.id}&view=history&visit=${visitId}`;
}

test('«Ya voy» desde la notificación responde con la sesión del residente: la visita lo ve y el aviso lo confirma', async ({ page, context, browser, baseURL }) => {
  const { home, devtools } = await openResidentHome(page, context, baseURL!);
  const visitor = await ringAsVisitor(browser, baseURL!, home, 'Soy Juan, del delivery');
  try {
    const visit = await onlyVisit(page, home);
    await devtools.deliverPush(ringPush(home, visit));
    await expect.poll(() => workerMessages(page)).toEqual([{ type: WORKER_MESSAGES.push, visitId: visit.id }]);
    const answered = nextApiResponse(context, '/api/answer');
    await tapNotification(await devtools.worker(), visit.id, 'reply:coming');

    expect((await answered).status()).toBe(200);
    // The worker tells the panel once its confirmation is on screen.
    await expect.poll(() => workerMessages(page)).toHaveLength(2);
    expect(await shownNotifications(page)).toEqual([{ title: 'Respuesta enviada', body: `Le avisamos a tu visita: «${VISIT_REPLIES.coming.label}».`, tag: visit.id, renotify: false, actions: [], data: { url: visitLink(home, visit.id) } }]);
    await expect(visitor.page.getByRole('heading', { name: VISIT_REPLIES.coming.visitorTitle })).toBeVisible({ timeout: 15_000 });
    await expect(visitRow(page, visit.message).getByText('Atendido', { exact: true })).toBeVisible();
    await expect(visitRow(page, visit.message)).toContainText(VISIT_REPLIES.coming.history);
  } finally { await visitor.close(); await deleteHome(page, baseURL!, home.id); }
});

test('si la visita ya tenía otra respuesta, la notificación avisa «Ya respondieron» y la visita conserva la primera', async ({ page, context, browser, baseURL }) => {
  const { home, devtools } = await openResidentHome(page, context, baseURL!);
  const visitor = await ringAsVisitor(browser, baseURL!, home, 'Soy Ana, traigo un paquete');
  try {
    const visit = await onlyVisit(page, home);
    await devtools.deliverPush(ringPush(home, visit));
    await expect.poll(() => workerMessages(page)).toEqual([{ type: WORKER_MESSAGES.push, visitId: visit.id }]);
    // Another resident answers first from the panel; with one live account, the same resident on another device.
    await visitRow(page, visit.message).getByRole('button', { name: VISIT_REPLIES.leave.label, exact: true }).click();
    await expect(visitRow(page, visit.message).getByText('Atendido', { exact: true })).toBeVisible();
    const firstAnswer = await onlyVisit(page, home);
    const answered = nextApiResponse(context, '/api/answer');
    await tapNotification(await devtools.worker(), visit.id, 'reply:coming');

    expect((await answered).status()).toBe(200);
    await expect.poll(() => workerMessages(page)).toHaveLength(2);
    expect(await shownNotifications(page)).toEqual([{ title: 'Ya respondieron', body: `${firstAnswer.answered_by} ya había respondido: tu visita ve otra respuesta.`, tag: visit.id, renotify: false, actions: [], data: { url: visitLink(home, visit.id) } }]);
    expect(await onlyVisit(page, home)).toMatchObject({ reply: 'leave', answered_by: firstAnswer.answered_by, answered_at: firstAnswer.answered_at });
    await expect(visitor.page.getByRole('heading', { name: VISIT_REPLIES.leave.visitorTitle })).toBeVisible({ timeout: 15_000 });
  } finally { await visitor.close(); await deleteHome(page, baseURL!, home.id); }
});

// Chromium only lets a worker focus or open a window from a notificationclick it dispatched itself, when the
// person taps the notification; DevTools cannot dispatch one. A tap built by script reaches the real handler,
// which then asks for the window and Chromium refuses: the refusal it reports says which one it asked for. The
// message the worker posts after focusing is then sent from the worker, as it would, to check the panel's side.
test('tocar la notificación sin elegir respuesta no responde la visita y pide abrir su historial, con o sin el panel abierto', async ({ page, context, browser, baseURL }) => {
  const { home, devtools } = await openResidentHome(page, context, baseURL!);
  const visitor = await ringAsVisitor(browser, baseURL!, home, 'Soy Leo, el vecino');
  const answers: string[] = [];
  context.on('request', (request) => { if (new URL(request.url()).pathname === '/api/answer') answers.push(request.url()); });
  try {
    const visit = await onlyVisit(page, home);
    await page.goto(`/?home=${home.id}`);
    await devtools.deliverPush(ringPush(home, visit));
    await expect.poll(() => workerMessages(page)).toEqual([{ type: WORKER_MESSAGES.push, visitId: visit.id }]);
    const [shown] = await shownNotifications(page, visit.id);
    expect(shown.data).toEqual({ url: visitLink(home, visit.id), visitId: visit.id });
    await tapNotification(await devtools.worker(), visit.id, '');

    // With the panel open, the worker goes to focus it.
    await expect.poll(() => devtools.errors).toContainEqual(expect.stringContaining('Not allowed to focus a window'));
    await expect.poll(() => shownNotifications(page, visit.id)).toEqual([]);
    await postFromWorker(await devtools.worker(), { type: WORKER_MESSAGES.open, url: visitLink(home, visit.id) });
    await expect(page).toHaveURL(new URL(visitLink(home, visit.id), baseURL).href);
    await expect(page.locator('article[aria-current="true"]')).toContainText(visit.message);
    await expect(visitRow(page, visit.message).getByRole('group', { name: 'Responder a la visita' })).toBeVisible();

    // Without a panel open (another page of the app still hears the worker), it goes to open one.
    await page.goto('/privacidad');
    await devtools.deliverPush(ringPush(home, visit));
    await expect.poll(() => workerMessages(page)).toEqual([{ type: WORKER_MESSAGES.push, visitId: visit.id }]);
    const pages = context.pages().length;
    await tapNotification(await devtools.worker(), visit.id, '');
    await expect.poll(() => devtools.errors).toContainEqual(expect.stringContaining('Not allowed to open a window'));
    expect(context.pages()).toHaveLength(pages);
    expect(answers).toEqual([]);
    expect((await homeSnapshot(page, home.id)).visits[0].answered_at).toBeNull();
  } finally { await visitor.close(); await deleteHome(page, baseURL!, home.id); }
});
