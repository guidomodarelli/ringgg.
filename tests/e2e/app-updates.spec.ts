import { test, expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { bundleFixture } from './support/bundle-fixture';

// The real hook in a real browser; the fixture server plays the deployment and can switch versions.
async function serveDeployments() {
  const bundled = await bundleFixture('tests/fixtures/app-updates-entry.tsx');
  const deployment = { version: 'deploy-1', pageLoads: 0 };
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled); return; }
    if (request.url === '/api/version') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ version: deployment.version })); return; }
    deployment.pageLoads += 1;
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html lang="es"><meta charset="utf-8"><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a TCP port');
  return { url: `http://127.0.0.1:${address.port}`, deployment, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
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

test('al volver a la app con un deploy nuevo se recarga sola, y sin deploy nuevo no', async ({ page }) => {
  const fixture = await serveDeployments();
  try {
    const versionRead = () => page.waitForResponse((response) => response.url().endsWith('/api/version'));
    const firstRead = versionRead();
    await page.goto(fixture.url);
    await firstRead;
    const sameVersion = versionRead();
    await leaveAndReturn(page);
    await sameVersion;
    expect(fixture.deployment.pageLoads).toBe(1);
    fixture.deployment.version = 'deploy-2';
    await leaveAndReturn(page);
    await expect.poll(() => fixture.deployment.pageLoads).toBe(2);
    await expect(page.getByRole('status')).toHaveText('Sin acciones');
  } finally { await fixture.close(); }
});

test('con una acción en curso espera a que termine antes de recargar', async ({ page }) => {
  const fixture = await serveDeployments();
  try {
    const firstRead = page.waitForResponse((response) => response.url().endsWith('/api/version'));
    await page.goto(fixture.url);
    await firstRead;
    await page.getByRole('button', { name: 'Empezar acción' }).click();
    fixture.deployment.version = 'deploy-2';
    const newVersionRead = page.waitForResponse((response) => response.url().endsWith('/api/version'));
    await leaveAndReturn(page);
    await newVersionRead;
    await expect(page.getByRole('status')).toHaveText('Acción en curso');
    expect(fixture.deployment.pageLoads).toBe(1);
    await page.getByRole('button', { name: 'Terminar acción' }).click();
    await expect.poll(() => fixture.deployment.pageLoads).toBe(2);
  } finally { await fixture.close(); }
});
