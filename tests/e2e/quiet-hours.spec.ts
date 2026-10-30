import { test, expect } from '@playwright/test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { bundleFixture } from './support/bundle-fixture';
import { readText } from './support/read-text';

test.use({ viewport: { width: 390, height: 844 } });

test('el horario de descanso es opcional y sus horas no desbordan en el teléfono', async ({ page }) => {
  const bundled = await bundleFixture('tests/fixtures/quiet-hours-entry.tsx');
  const css = readFileSync('src/app/globals.css', 'utf8');
  let home = { id: 1, name: 'Casa', token: 't', enabled: true, paused_until: null, quiet_start: null as string | null, quiet_end: null as string | null, paused: false, quiet: false };
  const bodies: unknown[] = [];
  async function answer(request: IncomingMessage, response: ServerResponse) {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled); return; }
    if (request.url === '/api/quiet-hours') { const input = JSON.parse(await readText(request)); bodies.push(input); home = { ...home, quiet_start: input.start, quiet_end: input.end }; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(home)); return; }
    response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  }
  const server = createServer((request, response) => { void answer(request, response); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Quiet hours test server did not expose a port');
    await page.goto(`http://127.0.0.1:${address.port}`);
    // Off by default: no time inputs, just the option to set a range.
    await expect(page.getByText('Desactivado: el timbre avisa a cualquier hora', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Desde')).toHaveCount(0);
    await page.getByRole('button', { name: 'Configurar horario' }).click();
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByLabel('Desde')).toHaveCount(0);
    expect(bodies).toEqual([]);

    await page.getByRole('button', { name: 'Configurar horario' }).click();
    for (const label of ['Desde', 'Hasta']) {
      const fits = await page.getByLabel(label).evaluate((input) => { const field = input.getBoundingClientRect(); const column = input.parentElement!.getBoundingClientRect(); return field.right <= column.right + 0.5 && field.right <= window.innerWidth && getComputedStyle(input).appearance === 'none'; });
      expect(fits, `${label} entra en su columna`).toBe(true);
    }
    await page.getByRole('button', { name: 'Guardar horario' }).click();
    await expect(page.getByText('Cada día de 22:00 a 08:00', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Quitar horario' }).click();
    await expect(page.getByLabel('Desde')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Configurar horario' })).toBeVisible();
    expect(bodies).toEqual([{ home: 1, start: '22:00', end: '08:00' }, { home: 1, start: null, end: null }]);
  } finally { await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); }
});
