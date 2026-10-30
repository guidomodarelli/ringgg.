import { test, expect } from '@playwright/test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { initialize } from '../../src/server/database';
import { addResident, listResidents, removeResident, renameResident } from '../../src/server/residents';
import { AppError } from '../../src/server/errors';
import { bundleFixture } from './support/bundle-fixture';
import { FIXTURE_HOME, apiPath } from './support/dashboard-initial';
import { readText } from './support/read-text';
import { testDatabase } from '../support/test-database';

test('un residente autoriza, comparte la invitación, renombra sin repetir, confirma una revocación y recupera errores sin perder el correo', async ({ page, context }) => {
  // Real React component, HTTP transport and PostgreSQL. Only the authenticated identity boundary is supplied.
  const postgres = new PGlite();
  const database = testDatabase(postgres);
  await initialize(database);
  const owner = { id: 'component-owner', email: 'owner@example.com', emailVerified: true };
  const outsider = { id: 'component-outsider', email: 'outsider@example.com', emailVerified: true };
  const settings = { bootstrapEmails: [owner.email] };
  await renameResident(database, owner, { homeId: FIXTURE_HOME, email: owner.email, name: 'Guido' }, settings);
  let currentIdentity = owner;
  let additions = 0;
  const sentHomes = new Set<unknown>();
  const bundled = await bundleFixture('tests/fixtures/resident-management-entry.tsx');
  async function changeResidents(request: IncomingMessage) {
    const input = JSON.parse(await readText(request));
    sentHomes.add(input.home);
    if (input.action === 'add') { additions += 1; await addResident(database, currentIdentity, { homeId: FIXTURE_HOME, email: input.email }, settings); }
    else if (input.action === 'rename') await renameResident(database, currentIdentity, { homeId: FIXTURE_HOME, email: input.email, name: input.name }, settings);
    else await removeResident(database, currentIdentity, { homeId: FIXTURE_HOME, email: input.email }, settings);
  }
  async function answer(request: IncomingMessage, response: ServerResponse) {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled); return; }
    if (!request.url?.startsWith('/api/') || apiPath(request.url) !== 'residents') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); return; }
    response.setHeader('Content-Type', 'application/json');
    try {
      if (request.method === 'POST') await changeResidents(request);
      else sentHomes.add(Number(new URL(request.url, 'http://127.0.0.1').searchParams.get('home')));
      response.end(JSON.stringify({ residents: await listResidents(database, FIXTURE_HOME, settings) }));
    } catch (error) { response.statusCode = error instanceof AppError ? error.status : 500; response.end(JSON.stringify({ error: error instanceof AppError ? error.message : 'No se pudo completar la prueba.' })); }
  }
  const server = createServer((request, response) => { void answer(request, response); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const members = async () => (await database.query('SELECT email FROM home_members WHERE home_id = $1 AND email <> $2', [FIXTURE_HOME, owner.email])).rows;
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Resident UI test server did not expose a TCP port');
    const origin = `http://127.0.0.1:${address.port}`;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await page.goto(origin);
    await expect(page.getByRole('button', { name: 'Quitar acceso a owner@example.com' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Compartir invitación' })).toHaveCount(0);
    await page.getByLabel('Correo del nuevo residente').fill('new@example.com');
    await page.getByRole('button', { name: 'Autorizar correo' }).dblclick();
    await expect(page.getByText('Correo autorizado.', { exact: false })).toBeVisible();
    await expect(page.getByText('new@example.com', { exact: true })).toBeVisible();
    expect(additions).toBe(1);
    expect(await members()).toHaveLength(1);
    // Without a share sheet (desktop Chromium), the invitation goes to the clipboard.
    await page.getByRole('button', { name: 'Compartir invitación' }).click();
    await expect(page.getByText('Invitación copiada', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Te sumé al timbre de Casa de prueba en Ringgg. Creá tu cuenta con new@example.com en https://ringgg.example/sign-in y verificá tu correo para entrar.');

    // Any resident names the others; a name already used in the home is rejected next to the field.
    await page.getByRole('button', { name: 'Editar el nombre de new@example.com' }).click();
    const nameField = page.getByLabel('Nombre de new@example.com');
    await nameField.fill('guído');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Ya hay alguien llamado «guído» en esta casa. Elegí otro nombre.');
    await expect(nameField).toHaveValue('guído');
    await nameField.fill('Cami');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Nombre actualizado.')).toBeVisible();
    await expect(page.getByText('Cami', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Quitar acceso a new@example.com' }).click();
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    expect(await members()).toHaveLength(1);
    await page.getByRole('button', { name: 'Quitar acceso a new@example.com' }).click();
    await page.getByRole('button', { name: 'Sí, quitar acceso' }).click();
    await expect(page.getByText('new@example.com', { exact: true })).toHaveCount(0);
    expect(await members()).toHaveLength(0);
    await expect(page.getByRole('button', { name: 'Compartir invitación' })).toHaveCount(0);
    currentIdentity = outsider;
    await page.getByLabel('Correo del nuevo residente').fill('retry@example.com');
    await page.getByRole('button', { name: 'Autorizar correo' }).click();
    await expect(page.getByRole('alert')).toContainText('Tu cuenta no tiene acceso a esta vivienda');
    await expect(page.getByLabel('Correo del nuevo residente')).toHaveValue('retry@example.com');
    currentIdentity = owner;
    await page.getByRole('button', { name: 'Autorizar correo' }).click();
    await expect(page.getByText('retry@example.com', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Actualizar residentes' }).click();
    await expect(page.getByText('retry@example.com', { exact: true })).toBeVisible();
    expect([...sentHomes]).toEqual([FIXTURE_HOME]);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await postgres.close(); }
});
