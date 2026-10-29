import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { initialize, type Database } from '../../src/server/database';
import { addResident, listResidents, removeResident } from '../../src/server/residents';
import { AppError } from '../../src/server/errors';

test('el administrador autoriza, confirma una revocación y recupera errores sin perder el correo', async ({ page }) => {
  // Real React component, HTTP transport and PostgreSQL. Only the authenticated identity boundary is supplied.
  const postgres = new PGlite();
  const database: Database = {
    query: (sql, params) => postgres.query(sql, params),
    transaction: (work) => postgres.transaction((transaction) => work({ query: (sql, params) => transaction.query(sql, params), transaction: async () => { throw new Error('Nested transactions are unsupported'); } })),
  };
  await initialize(database);
  const admin = { id: 'component-admin', email: 'owner@example.com', emailVerified: true, isAdmin: true };
  const settings = { adminEmails: admin.email, residentEmails: '' };
  let currentIdentity = admin;
  let additions = 0;
  const bundled = await build({ entryPoints: ['tests/fixtures/resident-management-entry.tsx'], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const server = createServer(async (request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled.outputFiles[0].text); return; }
    if (request.url !== '/api/residents') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); return; }
    response.setHeader('Content-Type', 'application/json');
    try {
      if (request.method === 'POST') {
        let text = ''; for await (const chunk of request) text += chunk;
        const input = JSON.parse(text);
        if (input.action === 'add') { additions += 1; await addResident(database, currentIdentity, input.email, settings); }
        else await removeResident(database, currentIdentity, input.email, settings);
      }
      response.end(JSON.stringify({ residents: await listResidents(database, currentIdentity, settings) }));
    } catch (error) { response.statusCode = error instanceof AppError ? error.status : 500; response.end(JSON.stringify({ error: error instanceof AppError ? error.message : 'No se pudo completar la prueba.' })); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Resident UI test server did not expose a TCP port');
    await page.goto(`http://127.0.0.1:${address.port}`);
    await expect(page.getByRole('button', { name: 'Quitar acceso a owner@example.com' })).toHaveCount(0);
    await page.getByLabel('Correo del nuevo residente').fill('new@example.com');
    await page.getByRole('button', { name: 'Autorizar correo' }).dblclick();
    await expect(page.getByText('Correo autorizado.', { exact: false })).toBeVisible();
    await expect(page.getByText('new@example.com', { exact: true })).toBeVisible();
    expect(additions).toBe(1);
    expect((await database.query('SELECT email FROM residents')).rows).toHaveLength(1);
    await page.getByRole('button', { name: 'Quitar acceso a new@example.com' }).click();
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    expect((await database.query('SELECT email FROM residents')).rows).toHaveLength(1);
    await page.getByRole('button', { name: 'Quitar acceso a new@example.com' }).click();
    await page.getByRole('button', { name: 'Sí, quitar acceso' }).click();
    await expect(page.getByText('new@example.com', { exact: true })).toHaveCount(0);
    expect((await database.query('SELECT email FROM residents')).rows).toHaveLength(0);
    currentIdentity = { ...admin, isAdmin: false };
    await page.getByLabel('Correo del nuevo residente').fill('retry@example.com');
    await page.getByRole('button', { name: 'Autorizar correo' }).click();
    await expect(page.getByRole('alert')).toContainText('Solo el administrador');
    await expect(page.getByLabel('Correo del nuevo residente')).toHaveValue('retry@example.com');
    currentIdentity = admin;
    await page.getByRole('button', { name: 'Autorizar correo' }).click();
    await expect(page.getByText('retry@example.com', { exact: true })).toBeVisible();
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await postgres.close(); }
});
