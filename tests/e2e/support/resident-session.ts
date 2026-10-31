import { expect, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { pushPayload } from '../../../src/server/push';
import type { DashboardSnapshot, Visit } from '../../../src/types/doorbell';

/** The synthetic resident of the Neon branch `ci`; without its credentials (forks, Dependabot) these specs skip. */
export const LIVE_RESIDENT = process.env.E2E_NEON_AUTH_EMAIL && process.env.E2E_NEON_AUTH_PASSWORD
  ? { email: process.env.E2E_NEON_AUTH_EMAIL, password: process.env.E2E_NEON_AUTH_PASSWORD }
  : null;
export const LIVE_RESIDENT_REQUIRED = 'Requiere un residente real verificado de Neon; nunca se simula el proveedor.';

/** After signing in, `next dev` may still be compiling the panel (or the door page) for the first time. */
const FIRST_COMPILE_TIMEOUT_MS = 30_000;

/** A home created for one test, so its devices, visits and ring limits never meet another spec's. */
export interface TestHome { id: number; name: string; token: string }

/**
 * Signs in on the real panel with the live resident. The first visit to a home asks who you are (prefilled
 * with the account name); then this browser goes on without notifications, so each test connects it where it needs.
 */
export async function signInResident(page: Page) {
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(LIVE_RESIDENT?.email ?? '');
  await page.getByLabel('Contraseña', { exact: true }).fill(LIVE_RESIDENT?.password ?? '');
  await page.getByRole('button', { name: 'Entrar a mi casa' }).click();
  const nameDialog = page.getByRole('dialog', { name: '¿Quién sos?' });
  const skipNotifications = page.getByRole('button', { name: 'Seguir sin avisos en este dispositivo' });
  await expect(nameDialog.or(skipNotifications)).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT_MS });
  if (await nameDialog.isVisible()) {
    await nameDialog.getByRole('button', { name: 'Guardar mi nombre' }).click();
    await expect(nameDialog).toHaveCount(0);
  }
  await skipNotifications.click();
}

/** The snapshot the panel reads for a home, with the resident's session. */
export async function homeSnapshot(page: Page, homeId: number): Promise<DashboardSnapshot> {
  const response = await page.request.get(`/api/dashboard?home=${homeId}`);
  expect(response.ok(), `GET /api/dashboard?home=${homeId} answered ${response.status()}`).toBe(true);
  return response.json() as Promise<DashboardSnapshot>;
}

/** Creates a home of the resident through the API, as the panel does; mutations need the app's origin. */
export async function createHome(page: Page, origin: string): Promise<TestHome> {
  const name = `Casa ${randomUUID().slice(0, 8)}`;
  const response = await page.request.post('/api/homes', { headers: { origin }, data: { name } });
  expect(response.ok(), `POST /api/homes answered ${response.status()}: ${await response.text()}`).toBe(true);
  const { id } = await response.json() as { id: number };
  return { id, name, token: (await homeSnapshot(page, id)).home.token };
}

/** Deletes a test home with its visits and the devices left without homes. */
export async function deleteHome(page: Page, origin: string, homeId: number) {
  const response = await page.request.post('/api/delete-home', { headers: { origin }, data: { home: homeId } });
  expect(response.ok(), `POST /api/delete-home answered ${response.status()}`).toBe(true);
}

/** A visitor rings from the home's public page in a browser of their own, and stays there to see the answer. */
export async function ringAsVisitor(browser: Browser, baseURL: string, home: TestHome, message: string) {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(`/t/${home.token}`);
  await page.getByLabel('¿Querés decir quién sos?').fill(message);
  await page.getByRole('button', { name: 'Tocar timbre', exact: true }).click();
  await expect(page.getByRole('heading', { name: '¡Ding, dong!' })).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT_MS });
  return { page, close: () => context.close() };
}

/** The only visit of a test home, as the server stored it. */
export async function onlyVisit(page: Page, home: TestHome): Promise<Visit> {
  const { visits } = await homeSnapshot(page, home.id);
  expect(visits).toHaveLength(1);
  return visits[0];
}

/** The push the server sends for a ring, built by the server's own payload function. */
export function ringPush(home: TestHome, visit: Visit) {
  return pushPayload({ kind: 'ring', homeId: home.id, title: `${home.name}: hay alguien en la puerta`, body: visit.message, visitId: visit.id, answerable: true });
}
