import { test } from '@playwright/test';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { initialize, type Database } from '../../src/server/database';
import { answerVisit, getHome, registerVisit, rotateToken, snapshot, updateHomeSettings, updateQuietHours } from '../../src/server/doorbell';

// Real Dashboard, HTTP transport and PostgreSQL; only the auth client and the Next router are stubbed.
test('el panel reconcilia cada acción con su propia respuesta y no re-renderiza si el polling no trae cambios', async ({ page }) => {
  test.setTimeout(120_000);
  const pg = new PGlite();
  const db: Database = { query: (s, p) => pg.query(s, p), transaction: (w) => pg.transaction((t) => w({ query: (s, p) => t.query(s, p), transaction: async () => { throw new Error('nested'); } })) };
  await initialize(db);
  const stub = resolve('tests/fixtures/dashboard-stubs.ts');
  const bundled = await build({ entryPoints: ['tests/fixtures/dashboard-entry.tsx'], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'stubs', setup(b) { b.onResolve({ filter: /^(next\/navigation|@\/lib\/auth-client)$/ }, () => ({ path: stub })); } }] });
  const css = readFileSync('src/app/globals.css', 'utf8');
  const hits: string[] = [];
  const body = async (r: import('node:http').IncomingMessage) => { let t = ''; for await (const c of r) t += c; return JSON.parse(t || '{}'); };
  const server = createServer(async (req, res) => {
    const url = req.url || '/';
    if (url === '/bundle.js') { res.end(bundled.outputFiles[0].text); return; }
    if (url.startsWith('/api/')) {
      hits.push(`${req.method} ${url}`); res.setHeader('Content-Type', 'application/json');
      const path = url.slice(5);
      if (path === 'dashboard') return res.end(JSON.stringify(await snapshot(db)));
      if (path === 'settings') { const i = await body(req); await updateHomeSettings(db, i.name, i.enabled); return res.end(JSON.stringify(await snapshot(db))); }
      if (path === 'quiet-hours') { const i = await body(req); await updateQuietHours(db, i.start, i.end); return res.end(JSON.stringify(await snapshot(db))); }
      if (path === 'rotate') { await rotateToken(db); return res.end(JSON.stringify(await snapshot(db))); }
      if (path === 'device-status') return res.end(JSON.stringify({ active: true }));
      if (path === 'answer') { const i = await body(req); return res.end(JSON.stringify(await answerVisit(db, i.id, i.reply, 'Guido'))); }
      res.statusCode = 404; return res.end('{}');
    }
    if (url === '/sw.js') { res.statusCode = 404; return res.end(''); }
    const initial = { ...(await snapshot(db)), pushReady: false, origin: 'http://127.0.0.1', isAdmin: false, residents: [] };
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html lang="es"><meta charset="utf-8"><style>${css}</style><body><div id="root"></div><script>window.__INITIAL__=${JSON.stringify(initial)}</script><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const results: Record<string, unknown> = {};
  const measureWindow = async <T,>(label: string, fn: () => Promise<T>) => { hits.length = 0; const c0 = await page.evaluate(() => (window as unknown as { __commits: number }).__commits); await fn(); const c1 = await page.evaluate(() => (window as unknown as { __commits: number }).__commits); results[label] = { requests: [...hits], requestCount: hits.length, commits: c1 - c0 }; };
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Notification', { value: { permission: 'granted', requestPermission: async () => 'granted' } });
    Object.defineProperty(window, 'PushManager', { value: function PushManager() {} });
    const registration = { pushManager: { getSubscription: async () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/perf' }) } };
    Object.defineProperty(navigator, 'serviceWorker', { value: { register: async () => registration, ready: Promise.resolve(registration), addEventListener() {}, removeEventListener() {} } });
  });
  await page.clock.install();
  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForTimeout(1500);
    await measureWindow('idle', () => page.waitForTimeout(10_500));
    await page.goto(`http://127.0.0.1:${port}/?view=settings`); await page.waitForTimeout(1000);
    await measureWindow('rename home', async () => { await page.getByLabel('Nombre de tu casa').fill('Casa perf'); await page.getByRole('button', { name: 'Guardar nombre' }).click(); await page.getByText('Nombre actualizado.').waitFor(); await expect(page.locator('.topbar strong')).toHaveText('Casa perf'); });
    await page.getByRole('button', { name: 'Configurar horario' }).click();
    await measureWindow('save quiet hours', async () => { await page.getByRole('button', { name: 'Guardar horario' }).click(); await page.getByText('Horario de descanso guardado', { exact: false }).waitFor(); });
    await updateQuietHours(db, null, null);
    const home = await getHome(db); const id = crypto.randomUUID(); await registerVisit(db, home.token, id, 'Perf visit', 'perf-client');
    await page.goto(`http://127.0.0.1:${port}/?view=history`); await page.waitForTimeout(1000);
    await measureWindow('answer visit', async () => { await page.getByRole('button', { name: 'Ya voy', exact: true }).click(); await page.getByText('Atendido', { exact: true }).waitFor(); });
    await page.goto(`http://127.0.0.1:${port}/?view=qr`); await page.waitForTimeout(1000);
    await measureWindow('rotate QR', async () => { await page.getByRole('button', { name: 'Regenerar QR' }).click(); await page.getByRole('button', { name: 'Sí, crear nuevo QR' }).click(); await page.getByText('Nuevo QR creado', { exact: false }).waitFor(); });
    // A tab suspended during the answer window resumes after it: the buttons must disappear.
    const late = crypto.randomUUID(); await registerVisit(db, (await getHome(db)).token, late, 'Visita suspendida', 'perf-client-2');
    await page.goto(`http://127.0.0.1:${port}/?view=history`);
    await expect(page.getByRole('button', { name: 'Ya voy', exact: true })).toBeVisible();
    await page.clock.fastForward('02:10');
    await expect(page.getByRole('button', { name: 'Ya voy', exact: true })).toHaveCount(0, { timeout: 15_000 });
  } finally { server.close(); await pg.close(); }
  const r = results as Record<string, { requests: string[]; commits: number }>;
  expect(r.idle.requests).toEqual(['GET /api/dashboard', 'GET /api/dashboard']);
  expect(r.idle.commits).toBe(0);
  expect(r['rename home'].requests).toEqual(['POST /api/settings']);
  expect(r['save quiet hours'].requests).toEqual(['POST /api/quiet-hours']);
  expect(r['answer visit'].requests).toEqual(['POST /api/answer']);
  expect(r['rotate QR'].requests).toEqual(['POST /api/rotate']);
});
