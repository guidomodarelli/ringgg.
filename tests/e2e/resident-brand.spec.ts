import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { bundleFixture } from './support/bundle-fixture';

test('el logo vuelve al resumen sin recargar y sin enviar avisos de prueba', async ({ page }) => {
  const bundled = await bundleFixture('tests/fixtures/resident-brand-entry.tsx');
  const apiRequests: string[] = [];
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled); return; }
    if (request.url?.startsWith('/api/')) { apiRequests.push(request.url); response.statusCode = 404; response.end('{}'); return; }
    response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Resident logo test server did not expose a port');
    await page.goto(`http://127.0.0.1:${address.port}/?home=1&view=settings`);
    await page.getByLabel('Dato sin guardar').fill('conservar');
    await page.getByRole('link', { name: 'Ringgg, volver al resumen' }).click();
    // The overview of the same home: the home stays in the address.
    await expect(page).toHaveURL(`http://127.0.0.1:${address.port}/?home=1`);
    await expect(page.getByLabel('Dato sin guardar')).toHaveValue('conservar');
    await expect(page.getByRole('link', { name: 'Resumen', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(apiRequests).toEqual([]);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
