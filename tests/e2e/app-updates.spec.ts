import { test, expect, type Page } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { bundleFixture } from './support/bundle-fixture';

/** Where the fixture's save sends the page once the server confirms it, like opening a just-created home. */
const PAGE_AFTER_SAVE = '/?home=2';
/** How long the next page takes to arrive after the save, like the data of a router push. */
const NEXT_PAGE_DELAY_MS = 300;

// The real hook in a real browser; the fixture server plays the deployment and can switch versions.
async function serveDeployments() {
  const bundled = await bundleFixture('tests/fixtures/app-updates-entry.tsx');
  const deployment = { version: 'deploy-1', pageLoads: [] as string[], versionReadsFail: false };
  /** Saves wait here until the spec answers them, so the change stays in flight. */
  const heldSaves: ServerResponse[] = [];
  let saveArrived = () => {};
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled); return; }
    if (request.url === '/api/version') {
      if (deployment.versionReadsFail) { response.statusCode = 500; response.end(); return; }
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ version: deployment.version })); return;
    }
    if (request.url === '/api/slow-save') { heldSaves.push(response); saveArrived(); return; }
    if (request.headers.rsc) { setTimeout(() => response.end('{}'), NEXT_PAGE_DELAY_MS); return; }
    deployment.pageLoads.push(request.url ?? '');
    response.setHeader('Content-Type', 'text/html');
    // Each deployment's page carries its own version, as a build inlines it into the bundle.
    response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><body><div id="root" data-app-version="${deployment.version}"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a TCP port');
  return {
    url: `http://127.0.0.1:${address.port}`, deployment,
    /** Resolves once a save reaches the server and is being held. */
    nextSave: () => new Promise<void>((resolve) => { saveArrived = resolve; }),
    answerSaves: () => {
      for (const response of heldSaves.splice(0)) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ next: PAGE_AFTER_SAVE })); }
    },
    close: () => new Promise<void>((resolve, reject) => {
      for (const response of heldSaves.splice(0)) response.destroy();
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

const versionRead = (page: Page) => page.waitForResponse((response) => response.url().endsWith('/api/version'));

test('al volver a la app con un deploy nuevo se recarga sola, y sin deploy nuevo no', async ({ page }) => {
  const fixture = await serveDeployments();
  try {
    const firstRead = versionRead(page);
    await page.goto(fixture.url);
    await firstRead;
    const sameVersion = versionRead(page);
    await leaveAndReturn(page);
    await sameVersion;
    expect(fixture.deployment.pageLoads).toHaveLength(1);
    fixture.deployment.version = 'deploy-2';
    await leaveAndReturn(page);
    await expect.poll(() => fixture.deployment.pageLoads.length).toBe(2);
    await expect(page.getByRole('status')).toHaveText('Sin acciones');
  } finally { await fixture.close(); }
});

test('compara con la versión que cargó la página: un deploy mientras falla la primera lectura también la recarga', async ({ page }) => {
  const fixture = await serveDeployments();
  try {
    fixture.deployment.versionReadsFail = true;
    const failedRead = versionRead(page);
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
    const sameVersion = versionRead(page);
    await leaveAndReturn(page);
    await sameVersion;
    expect(fixture.deployment.pageLoads).toHaveLength(2);
  } finally { await fixture.close(); }
});

test('con una acción en curso espera a que termine antes de recargar', async ({ page }) => {
  const fixture = await serveDeployments();
  try {
    const firstRead = versionRead(page);
    await page.goto(fixture.url);
    await firstRead;
    await page.getByRole('button', { name: 'Empezar acción' }).click();
    fixture.deployment.version = 'deploy-2';
    const newVersionRead = versionRead(page);
    await leaveAndReturn(page);
    await newVersionRead;
    await expect(page.getByRole('status')).toHaveText('Acción en curso');
    expect(fixture.deployment.pageLoads).toHaveLength(1);
    await page.getByRole('button', { name: 'Terminar acción' }).click();
    await expect.poll(() => fixture.deployment.pageLoads.length).toBe(2);
  } finally { await fixture.close(); }
});

test('un cambio en vuelo de cualquier componente frena la recarga, y lo que sigue a su respuesta llega a correr', async ({ page }) => {
  const fixture = await serveDeployments();
  try {
    const firstRead = versionRead(page);
    await page.goto(fixture.url);
    await firstRead;
    const saveHeld = fixture.nextSave();
    await page.getByRole('button', { name: 'Guardar cambio' }).click();
    await saveHeld;
    fixture.deployment.version = 'deploy-2';
    const newVersionRead = versionRead(page);
    await leaveAndReturn(page);
    await newVersionRead;
    // Let the hook react to the new version before checking that it did not reload.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
    await expect(page.getByRole('status')).toHaveText('Guardando cambio');
    expect(fixture.deployment.pageLoads).toHaveLength(1);
    fixture.answerSaves();
    // It reloads only after the save opened its next page, so the reload lands there.
    await expect.poll(() => fixture.deployment.pageLoads).toEqual(['/', PAGE_AFTER_SAVE]);
  } finally { await fixture.close(); }
});
