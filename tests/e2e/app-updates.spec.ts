import { test, expect, type Page, type Response } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { RELOADS_STARTED_STORAGE_KEY } from '../fixtures/app-updates-contract';
import { bundleFixture } from './support/bundle-fixture';

/** Where the fixture's save takes the page once the server confirms it, like opening a just-created home. */
const NEXT_PAGE = '/?home=2';
/** Far longer than any wait before reloading could last: if the page had scheduled a reload, it would run. */
const LONG_PAUSE_MS = 10 * 60 * 1_000;
/** Also names the version in a header, so the spec tells reads apart without reading a body a reload may discard. */
const VERSION_HEADER = 'x-fixture-version';

// The real hook in a real browser; the fixture server plays the deployment and can switch versions.
async function serveDeployments() {
  const bundled = await bundleFixture('tests/fixtures/app-updates-entry.tsx');
  const deployment = { version: 'deploy-1', pageLoads: [] as string[], versionReadsFail: false, holdVersionReads: false };
  /** Requests that wait here until the spec answers them, so what they belong to stays in progress. */
  const held = { saves: [] as ServerResponse[], nextPages: [] as ServerResponse[], versionReads: [] as ServerResponse[] };
  const answerJson = (response: ServerResponse, body: unknown) => {
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(body));
  };
  const answerVersion = (response: ServerResponse) => {
    response.setHeader(VERSION_HEADER, deployment.version); answerJson(response, { version: deployment.version });
  };
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled); return; }
    if (request.url === '/api/version') {
      if (deployment.versionReadsFail) { response.statusCode = 500; response.end(); return; }
      if (deployment.holdVersionReads) { held.versionReads.push(response); return; }
      answerVersion(response); return;
    }
    if (request.url === '/api/slow-save') { held.saves.push(response); return; }
    // The data of the next page, as a router push reads it before changing the address.
    if (request.headers.rsc) { held.nextPages.push(response); return; }
    deployment.pageLoads.push(request.url ?? '');
    response.setHeader('Content-Type', 'text/html');
    // Each deployment's page carries its own version, as a build inlines it into the bundle.
    response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><body><div id="root" data-app-version="${deployment.version}"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a TCP port');
  return {
    url: `http://127.0.0.1:${address.port}`, deployment, held,
    answerSaves: () => { for (const response of held.saves.splice(0)) answerJson(response, { next: NEXT_PAGE }); },
    answerNextPages: () => { for (const response of held.nextPages.splice(0)) answerJson(response, {}); },
    answerVersionReads: () => { for (const response of held.versionReads.splice(0)) answerVersion(response); },
    close: () => new Promise<void>((resolve, reject) => {
      for (const response of Object.values(held).flatMap((responses) => responses.splice(0))) response.destroy();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

/** Leaves the app and comes back, as when the installed PWA goes to the background and is reopened. */
async function leaveAndReturn(page: Page) {
  for (const state of ['hidden', 'visible']) {
    await page.evaluate((visibility) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  }
}

/** The next answer of `/api/version` that carries `version`; a read answered before a deploy does not count. */
function versionRead(page: Page, version: string) {
  return page.waitForResponse((response) => response.url().endsWith('/api/version') && response.headers()[VERSION_HEADER] === version);
}

/**
 * Waits until the page acted on that read: its body arrived, and a task queued afterwards ran, so the
 * task that read the body (and reloads or not, without waiting for anything) already ran too.
 */
async function handled(page: Page, read: Promise<Response>) {
  await (await read).finished();
  await page.evaluate(() => new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.addEventListener('message', () => resolve());
    channel.port1.start();
    channel.port2.postMessage(null);
  }));
}

/** Reloads the page started, counted by the fixture the moment each one starts. */
function reloadsStarted(page: Page) {
  return page.evaluate((key) => Number(sessionStorage.getItem(key) ?? 0), RELOADS_STARTED_STORAGE_KEY);
}

async function openApp(page: Page, url: string) {
  const firstRead = versionRead(page, 'deploy-1');
  await page.goto(url);
  await firstRead;
}

test('al volver a la app con un deploy nuevo se recarga sola, y sin deploy nuevo no', async ({ page }) => {
  const fixture = await serveDeployments();
  try {
    await openApp(page, fixture.url);
    const sameVersion = versionRead(page, 'deploy-1');
    await leaveAndReturn(page);
    await handled(page, sameVersion);
    expect(await reloadsStarted(page)).toBe(0);
    fixture.deployment.version = 'deploy-2';
    await leaveAndReturn(page);
    await expect.poll(() => fixture.deployment.pageLoads).toEqual(['/', '/']);
    await expect(page.locator('#root[data-app-version="deploy-2"]').getByRole('status')).toHaveText('Sin acciones');
  } finally { await fixture.close(); }
});

test('compara con la versión que cargó la página: un deploy mientras falla la primera lectura también la recarga', async ({ page }) => {
  const fixture = await serveDeployments();
  try {
    fixture.deployment.versionReadsFail = true;
    const failedRead = page.waitForResponse((response) => response.url().endsWith('/api/version'));
    await page.goto(fixture.url);
    expect((await failedRead).status()).toBe(500);
    // Every read on opening failed (on mount and on `pageshow`). The page runs deploy-1, and the
    // next read that succeeds already sees deploy-2.
    await page.waitForLoadState('networkidle');
    fixture.deployment.version = 'deploy-2';
    fixture.deployment.versionReadsFail = false;
    await leaveAndReturn(page);
    await expect.poll(() => fixture.deployment.pageLoads.length).toBe(2);
    // The reloaded page runs deploy-2, so it stays.
    await expect(page.locator('#root[data-app-version="deploy-2"]').getByRole('status')).toHaveText('Sin acciones');
    const sameVersion = versionRead(page, 'deploy-2');
    await leaveAndReturn(page);
    await handled(page, sameVersion);
    expect(fixture.deployment.pageLoads).toHaveLength(2);
  } finally { await fixture.close(); }
});

test('si al volver hay una acción en curso no recarga, ni sola al terminarla: espera a la próxima vuelta', async ({ page }) => {
  const fixture = await serveDeployments();
  try {
    await page.clock.install();
    await openApp(page, fixture.url);
    await page.getByRole('button', { name: 'Empezar acción' }).click();
    fixture.deployment.version = 'deploy-2';
    const busyRead = versionRead(page, 'deploy-2');
    await leaveAndReturn(page);
    await handled(page, busyRead);
    await expect(page.getByRole('status')).toHaveText('Acción en curso');
    expect(await reloadsStarted(page)).toBe(0);
    await page.getByRole('button', { name: 'Terminar acción' }).click();
    await expect(page.getByRole('status')).toHaveText('Sin acciones');
    await page.clock.runFor(LONG_PAUSE_MS);
    expect(await reloadsStarted(page)).toBe(0);
    await leaveAndReturn(page);
    await expect.poll(() => fixture.deployment.pageLoads).toEqual(['/', '/']);
  } finally { await fixture.close(); }
});

test('un cambio en vuelo de cualquier componente frena la recarga, y la navegación que sigue a su respuesta termina sin cortes', async ({ page }) => {
  const fixture = await serveDeployments();
  try {
    await page.clock.install();
    await openApp(page, fixture.url);
    await page.getByRole('button', { name: 'Guardar cambio' }).click();
    await expect.poll(() => fixture.held.saves.length).toBe(1);
    fixture.deployment.version = 'deploy-2';
    const savingRead = versionRead(page, 'deploy-2');
    await leaveAndReturn(page);
    await handled(page, savingRead);
    await expect(page.getByRole('status')).toHaveText('Guardando cambio');
    expect(await reloadsStarted(page)).toBe(0);
    fixture.answerSaves();
    // The save has its answer and the next page is still on its way, however long it takes.
    await expect.poll(() => fixture.held.nextPages.length).toBe(1);
    await page.clock.runFor(LONG_PAUSE_MS);
    fixture.answerNextPages();
    await expect(page).toHaveURL(`${fixture.url}${NEXT_PAGE}`);
    await expect(page.getByRole('status')).toHaveText('Sin acciones');
    expect(await reloadsStarted(page)).toBe(0);
    expect(fixture.deployment.pageLoads).toEqual(['/']);
    // The next return reloads, already on the page the save opened.
    await leaveAndReturn(page);
    await expect.poll(() => fixture.deployment.pageLoads).toEqual(['/', NEXT_PAGE]);
  } finally { await fixture.close(); }
});

test('si se abre otra página mientras lee la versión no la corta: recarga en la próxima vuelta, ya en esa página', async ({ page }) => {
  const fixture = await serveDeployments();
  try {
    await openApp(page, fixture.url);
    fixture.deployment.version = 'deploy-2';
    fixture.deployment.holdVersionReads = true;
    await leaveAndReturn(page);
    await expect.poll(() => fixture.held.versionReads.length).toBeGreaterThan(0);
    await page.evaluate((next) => { window.history.pushState(null, '', next); }, NEXT_PAGE);
    fixture.deployment.holdVersionReads = false;
    const readDuringNavigation = versionRead(page, 'deploy-2');
    fixture.answerVersionReads();
    await handled(page, readDuringNavigation);
    expect(await reloadsStarted(page)).toBe(0);
    await leaveAndReturn(page);
    await expect.poll(() => fixture.deployment.pageLoads).toEqual(['/', NEXT_PAGE]);
  } finally { await fixture.close(); }
});
