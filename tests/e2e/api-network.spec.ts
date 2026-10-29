import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer } from 'node:http';

test('explica fallas de conexión y conserva los errores específicos del servidor', async ({ page }) => {
  const bundle = await build({ entryPoints: ['tests/fixtures/api-network-entry.ts'], bundle: true, write: false, platform: 'browser' });
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return; }
    if (request.url === '/api/server-error') { response.writeHead(403, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'No tenés acceso a esta vivienda.' })); return; }
    if (request.url?.startsWith('/api/')) { request.socket.destroy(); return; }
    response.end('<button id="read">Consultar</button><button id="write">Guardar</button><button id="server-error">Consultar acceso</button><p id="result" role="alert"></p><script src="/bundle.js"></script>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No se pudo iniciar el servidor de prueba.');
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.getByRole('button', { name: 'Consultar', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Revisá tu conexión a internet');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('alert')).toContainText('el estado actual antes de volver a intentar');
    await page.getByRole('button', { name: 'Consultar acceso' }).click();
    await expect(page.getByRole('alert')).toHaveText('No tenés acceso a esta vivienda.');
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
