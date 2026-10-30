import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { bundleFixture } from './support/bundle-fixture';

test('las secciones tienen direcciones y el historial del navegador conserva la vista', async ({ page }) => {
  const bundled = await bundleFixture('tests/fixtures/dashboard-navigation-entry.tsx');
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled); return; }
    response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Dashboard navigation test server did not expose a port');
    await page.goto(`http://127.0.0.1:${address.port}/?home=1&view=devices`);
    await expect(page.getByRole('link', { name: 'Dispositivos' })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: 'Mi código QR' }).click();
    await expect(page).toHaveURL(`http://127.0.0.1:${address.port}/?home=1&view=qr`);
    await expect(page.getByRole('link', { name: 'Mi código QR' })).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(page.getByRole('link', { name: 'Dispositivos' })).toHaveAttribute('aria-current', 'page');
    await page.goForward();
    await expect(page.getByRole('link', { name: 'Mi código QR' })).toHaveAttribute('aria-current', 'page');
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
