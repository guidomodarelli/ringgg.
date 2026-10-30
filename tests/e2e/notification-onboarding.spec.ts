import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer } from 'node:http';

test('la activación inicial es accesible, recupera un permiso bloqueado y permite seguir sin avisos', async ({ page }) => {
  const bundled = await build({ entryPoints: ['tests/fixtures/notification-onboarding-entry.tsx'], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled.outputFiles[0].text); return; }
    response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Notification UI test server did not expose a port');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`http://127.0.0.1:${address.port}`);
    const dialog = page.getByRole('dialog', { name: 'Que no se te escape ninguna visita.' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Activar notificaciones' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Activar notificaciones' }).click();
    await expect(page.getByText('Activación solicitada')).toBeVisible();
    await page.getByRole('button', { name: 'Permiso bloqueado' }).click();
    await expect(dialog.getByText('Las notificaciones están bloqueadas.', { exact: false })).toBeVisible();
    await dialog.getByRole('button', { name: 'Volver a comprobar' }).click();
    await expect(dialog.getByRole('button', { name: 'Activar notificaciones' })).toBeVisible();
    // A computer that only prints the QR or manages residents can keep going without notifications.
    await expect(dialog.getByText('Podés activarlos después desde Dispositivos.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Seguir sin avisos en este dispositivo' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Sigue sin avisos')).toBeVisible();
    // With the permission already granted, the browser only needs to be connected to this home.
    await page.getByRole('button', { name: 'Permiso concedido' }).click();
    await expect(dialog.getByText('todavía no está conectado a «Casa de prueba»', { exact: false })).toBeVisible();
    await dialog.getByRole('button', { name: 'Conectar este dispositivo' }).click();
    await expect(page.getByText('Activación solicitada')).toBeVisible();
    await page.getByRole('button', { name: 'Mostrar activación' }).click();
    await dialog.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(dialog).toHaveCount(0);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
