import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { initialize, type Database } from '../../src/server/database';
import { answerVisit, getHome, leaveNote, readVisit, registerVisit, setDelivery, snapshot } from '../../src/server/doorbell';
import { AppError } from '../../src/server/errors';

// Real React components, HTTP transport and PostgreSQL. Push providers and the resident session are outside the fixture.
function adapter(postgres: PGlite): Database {
  return { query: (sql, params) => postgres.query(sql, params), transaction: (work) => postgres.transaction((transaction) => work({ query: (sql, params) => transaction.query(sql, params), transaction: async () => { throw new Error('Nested transactions are unsupported'); } })) };
}
async function readBody(request: IncomingMessage) { let text = ''; for await (const chunk of request) text += chunk; return JSON.parse(text || '{}'); }
function sendError(response: ServerResponse, error: unknown) { response.statusCode = error instanceof AppError ? error.status : 500; response.end(JSON.stringify({ error: error instanceof AppError ? error.message : 'No se pudo completar la prueba.' })); }

async function serve(entry: string, inject: string, api: (request: IncomingMessage, response: ServerResponse, path: string) => Promise<boolean>) {
  const bundled = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const server = createServer(async (request, response) => {
    const path = request.url || '/';
    if (path === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled.outputFiles[0].text); return; }
    if (path.startsWith('/api/')) { response.setHeader('Content-Type', 'application/json'); try { if (await api(request, response, path.slice(5))) return; response.statusCode = 404; response.end('{}'); } catch (error) { sendError(response, error); } return; }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><body><div id="root"></div><script>${inject}</script><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a TCP port');
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

test('el visitante ve "No están en casa" y deja un único mensaje aunque haga doble click', async ({ page }) => {
  const postgres = new PGlite();
  const database = adapter(postgres);
  await initialize(database);
  const home = await getHome(database);
  let notes = 0;
  const fixture = await serve('tests/fixtures/visitor-entry.tsx', `window.__VISITOR__=${JSON.stringify({ home: { name: home.name, enabled: true, quiet: false, quietUntil: null }, token: home.token })}`, async (request, response, path) => {
    const [, token, , id, action] = path.split('/');
    if (request.method === 'POST' && !id) {
      const input = await readBody(request);
      const result = await registerVisit(database, token, input.id, input.message, 'fixture-client');
      if (result.created) await setDelivery(database, input.id, 'unavailable');
      response.end(JSON.stringify(await readVisit(database, token, input.id))); return true;
    }
    if (request.method === 'POST' && action === 'note') { notes += 1; const input = await readBody(request); response.end(JSON.stringify((await leaveNote(database, token, id, input.note)).visit)); return true; }
    if (request.method === 'GET' && id) { response.end(JSON.stringify(await readVisit(database, token, id))); return true; }
    return false;
  });
  try {
    await page.goto(fixture.url);
    await page.getByLabel('¿Querés decir quién sos?').fill('Soy Juan');
    await page.getByRole('button', { name: 'Tocar timbre', exact: true }).dblclick();
    await expect(page.getByRole('heading', { name: '¡Ding, dong!' })).toBeVisible();
    const [visit] = (await snapshot(database)).visits;
    expect((await snapshot(database)).visits).toHaveLength(1);
    await answerVisit(database, visit.id, 'away', 'Guido');
    await expect(page.getByRole('heading', { name: 'No están en casa' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Guido')).toHaveCount(0);
    await page.getByLabel('Dejales un mensaje').fill('Vuelvo mañana a las 10');
    await page.getByRole('button', { name: 'Dejar mensaje' }).dblclick();
    await expect(page.getByText('Le dejamos tu mensaje.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dejar mensaje' })).toHaveCount(0);
    expect(notes).toBe(1);
    expect((await snapshot(database)).visits[0].note).toBe('Vuelvo mañana a las 10');
  } finally { await fixture.close(); await postgres.close(); }
});

test('en horario de descanso el visitante no puede tocar y ve hasta cuándo', async ({ page }) => {
  let checks = 0;
  const fixture = await serve('tests/fixtures/visitor-entry.tsx', `window.__VISITOR__=${JSON.stringify({ home: { name: 'Casa', enabled: true, quiet: true, quietUntil: '08:00' }, token: 'token' })}`, async (request, response, path) => {
    if (request.method !== 'GET' || path !== 'door/token') return false;
    checks += 1; response.end(JSON.stringify({ name: 'Casa', enabled: true, quiet: false, quietUntil: null })); return true;
  });
  try {
    await page.clock.install();
    await page.goto(fixture.url);
    await expect(page.getByRole('heading', { name: 'Es horario de descanso' })).toBeVisible();
    await expect(page.getByText('El timbre vuelve a sonar a las 08:00.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tocar timbre' })).toHaveCount(0);
    // When quiet hours end the open page rechecks availability and shows the ring form.
    await page.clock.runFor(60_000);
    await expect(page.getByRole('button', { name: 'Tocar timbre' })).toBeVisible();
    expect(checks).toBe(1);
  } finally { await fixture.close(); }
});

test('el residente responde con una respuesta rápida y el historial muestra quién y cuánto tardó', async ({ page }) => {
  const postgres = new PGlite();
  const database = adapter(postgres);
  await initialize(database);
  const home = await getHome(database);
  const id = crypto.randomUUID();
  await registerVisit(database, home.token, id, 'Soy del correo', 'fixture-client');
  await setDelivery(database, id, 'sent');
  let answers = 0;
  const fixture = await serve('tests/fixtures/visit-history-entry.tsx', `window.__VISITS__=${JSON.stringify((await snapshot(database)).visits)}`, async (request, response, path) => {
    if (path === 'answer' && request.method === 'POST') { answers += 1; const input = await readBody(request); response.end(JSON.stringify(await answerVisit(database, input.id, input.reply, 'Guido'))); return true; }
    if (path === 'dashboard') { response.end(JSON.stringify(await snapshot(database))); return true; }
    return false;
  });
  try {
    await page.goto(fixture.url);
    const row = page.locator('.visit-row.focused');
    await expect(row).toContainText('Aviso enviado');
    for (const label of ['Ya voy', 'En 5 minutos', 'Dejalo en la puerta', 'No estoy']) await expect(row.getByRole('button', { name: label, exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Dejalo en la puerta', exact: true }).dblclick();
    await expect(page.getByRole('status')).toHaveText('Tu visita ya ve: «Dejalo en la puerta».');
    await expect(row.getByText('Atendido', { exact: true })).toBeVisible();
    await expect(row).toContainText('Guido · Pidió dejarlo en la puerta · respondió en');
    await expect(row.getByRole('button')).toHaveCount(0);
    expect(answers).toBe(1);
  } finally { await fixture.close(); await postgres.close(); }
});
