import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { bundleFixture } from './support/bundle-fixture';

test('el acceso nuevo ofrece Google y comunica si aún no está configurado', async ({ page }) => {
  const bundled = await bundleFixture('tests/fixtures/google-login-entry.tsx');
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled); return; }
    response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Google login test server did not expose a port');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Continuar con Google' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continuar con Google' })).toBeDisabled();
    await expect(page.getByRole('status')).toContainText('El acceso no está disponible');
    await expect(page.getByLabel('Contraseña')).toHaveCount(0);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
