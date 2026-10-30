import { test, expect } from '@playwright/test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { initialize } from '../../src/server/database';
import { setPause, snapshot } from '../../src/server/doorbell';
import { PAUSE_MODES, type PauseMode } from '../../src/constants/doorbell';
import { bundleFixture } from './support/bundle-fixture';
import { FIXTURE_HOME } from './support/dashboard-initial';
import { testDatabase } from '../support/test-database';
import { readText } from './support/read-text';

// Real settings section, HTTP transport and PostgreSQL behind the same pause operation as `/api/pause`.
test('pausar pregunta por cuánto tiempo; cancelar no cambia nada y reactivar es inmediato', async ({ page }) => {
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const bundled = await bundleFixture('tests/fixtures/doorbell-pause-entry.tsx');
  const modes: PauseMode[] = [];
  async function answer(request: IncomingMessage, response: ServerResponse) {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled); return; }
    if (request.url === '/api/pause') {
      const { home, mode } = JSON.parse(await readText(request)) as { home: number; mode: PauseMode };
      if (home !== FIXTURE_HOME || !PAUSE_MODES.includes(mode)) { response.statusCode = 400; response.end('{}'); return; }
      modes.push(mode); await setPause(database, FIXTURE_HOME, mode);
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(await snapshot(database, FIXTURE_HOME))); return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><body><div id="root"></div><script>window.__HOME__=${JSON.stringify((await snapshot(database, FIXTURE_HOME)).home)}</script><script src="/bundle.js"></script></body></html>`);
  }
  const server = createServer((request, response) => { void answer(request, response); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const homeRow = async () => (await database.query<{ enabled: boolean; paused_until: string | null }>('SELECT enabled, paused_until FROM homes WHERE id = 1')).rows[0];
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Pause test server did not expose a port');
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.getByRole('button', { name: 'Pausar timbre' }).click();
    const options = page.getByRole('group', { name: /las visitas no podrán enviar avisos/ });
    await expect(options).toBeVisible();
    await expect(options.getByRole('button', { name: 'Durante 1 hora' })).toBeFocused();
    await options.getByRole('button', { name: 'Cancelar' }).click();
    expect(modes).toEqual([]);
    expect(await homeRow()).toEqual({ enabled: true, paused_until: null });

    await page.getByRole('button', { name: 'Pausar timbre' }).click();
    await page.getByRole('button', { name: 'Durante 1 hora' }).click();
    await expect(page.getByRole('status')).toHaveText('Timbre pausado durante 1 hora.');
    await expect(page.getByText(/El timbre está en pausa hasta (mañana a )?las \d{2}:\d{2}/)).toBeVisible();
    const timed = await homeRow();
    expect(timed.enabled).toBe(true);
    expect(new Date(timed.paused_until!).getTime()).toBeGreaterThan(Date.now() + 55 * 60 * 1000);

    await page.getByRole('button', { name: 'Activar timbre' }).click();
    await expect(page.getByRole('button', { name: 'Pausar timbre' })).toBeVisible();
    expect(await homeRow()).toEqual({ enabled: true, paused_until: null });

    await page.getByRole('button', { name: 'Pausar timbre' }).click();
    await page.getByRole('button', { name: 'Hasta que lo reactive' }).click();
    await expect(page.getByText('El timbre está en pausa hasta que lo reactives', { exact: false })).toBeVisible();
    expect(await homeRow()).toEqual({ enabled: false, paused_until: null });
    expect(modes).toEqual(['hour', 'resume', 'indefinite']);
  } finally { await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); await postgres.close(); }
});
