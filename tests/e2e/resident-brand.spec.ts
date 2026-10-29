import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer } from 'node:http';

test('el logo vuelve al resumen sin recargar y envía una sola prueba mientras está pendiente', async ({ page }) => {
  const bundled = await build({ entryPoints: ['tests/fixtures/resident-brand-entry.tsx'], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  let requests = 0;
  let release!: () => void;
  let received!: () => void;
  const waitForResponse = new Promise<void>((resolve) => { release = resolve; });
  const requestReceived = new Promise<void>((resolve) => { received = resolve; });
  const server = createServer(async (request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled.outputFiles[0].text); return; }
    if (request.url === '/api/test-my-devices') {
      requests += 1; received(); await waitForResponse;
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ accepted: 1, total: 1 })); return;
    }
    response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Resident logo test server did not expose a port');
    await page.goto(`http://127.0.0.1:${address.port}/?view=settings`);
    await page.getByLabel('Dato sin guardar').fill('conservar');
    const logo = page.getByRole('button', { name: 'Volver al resumen y enviar una notificación de prueba' });
    await logo.click();
    await requestReceived;
    await logo.click();
    expect(requests).toBe(1);
    await expect(page).toHaveURL(`http://127.0.0.1:${address.port}/`);
    await expect(page.getByLabel('Dato sin guardar')).toHaveValue('conservar');
    await expect(page.getByRole('link', { name: 'Resumen' })).toHaveAttribute('aria-current', 'page');
    release();
    await expect(page.getByRole('status')).toContainText('Enviamos la prueba. Revisá tu celular.');
  } finally { release(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
