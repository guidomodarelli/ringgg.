import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { initialize, type Database } from '../../src/server/database';

test('pausar requiere confirmación; cancelar no cambia el timbre y reactivar es inmediato', async ({ page }) => {
  const postgres = new PGlite();
  const database: Database = { query: (sql, params) => postgres.query(sql, params), transaction: (work) => postgres.transaction((transaction) => work({ query: (sql, params) => transaction.query(sql, params), transaction: async () => { throw new Error('Nested transactions are unsupported'); } })) };
  await initialize(database);
  const bundled = await build({ entryPoints: ['tests/fixtures/doorbell-pause-entry.tsx'], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  let requests = 0;
  const server = createServer(async (request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled.outputFiles[0].text); return; }
    if (request.url === '/settings') { let text = ''; for await (const chunk of request) text += chunk; const input = JSON.parse(text); requests += 1; await database.query('UPDATE homes SET enabled = $1 WHERE id = 1', [input.enabled]); response.setHeader('Content-Type', 'application/json'); response.end('{}'); return; }
    response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Pause test server did not expose a port');
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.getByRole('button', { name: 'Pausar timbre' }).click();
    await expect(page.getByRole('alert')).toContainText('las visitas no podrán enviar avisos');
    await page.getByRole('button', { name: 'Cancelar' }).click();
    expect(requests).toBe(0);
    expect((await database.query<{ enabled: boolean }>('SELECT enabled FROM homes WHERE id = 1')).rows[0].enabled).toBe(true);
    await page.getByRole('button', { name: 'Pausar timbre' }).click();
    await page.getByRole('button', { name: 'Sí, pausar timbre' }).click();
    await expect(page.getByRole('button', { name: 'Activar timbre' })).toBeVisible();
    expect(requests).toBe(1);
    expect((await database.query<{ enabled: boolean }>('SELECT enabled FROM homes WHERE id = 1')).rows[0].enabled).toBe(false);
    await page.getByRole('button', { name: 'Activar timbre' }).click();
    await expect(page.getByRole('button', { name: 'Pausar timbre' })).toBeVisible();
    expect(requests).toBe(2);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await postgres.close(); }
});
