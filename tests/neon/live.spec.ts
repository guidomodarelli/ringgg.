import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

test('Neon real: registro, sesión, denegación de vivienda, cierre y nuevo login', async ({ page }) => {
  test.skip(!process.env.NEON_AUTH_BASE_URL || !process.env.NEON_BRANCH, 'Requiere neon deploy y la app iniciada.');
  const email = `ringgg-e2e-${randomBytes(8).toString('hex')}@example.invalid`;
  const password = randomBytes(24).toString('base64url');
  let userId = '';
  try {
    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'Crear una cuenta' }).click();
    await page.getByLabel('Tu nombre').fill('Prueba temporal Ringgg');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    const signupPromise = page.waitForResponse((response) => response.url().includes('/api/auth/sign-up/email'));
    await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
    const signup = await signupPromise;
    expect(signup.status()).toBe(200);
    const created = await signup.json();
    userId = created.user.id;
    expect(created.user.email).toBe(email);
    expect(created.user.emailVerified).toBe(false);

    const sessionResponse = await page.request.get('/api/auth/get-session');
    expect(sessionResponse.status()).toBe(200);
    expect((await sessionResponse.json()).user.id).toBe(userId);
    const denied = await page.request.get('/api/dashboard');
    expect(denied.status()).toBe(403);
    expect((await denied.json()).code).toBe('EMAIL_UNVERIFIED');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Verificá tu correo' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tu casa te llama.' })).toHaveCount(0);

    const signout = await page.request.post('/api/auth/sign-out', { headers: { origin: process.env.APP_URL || 'http://localhost:3000' }, data: {} });
    expect(signout.ok()).toBe(true);
    expect(await (await page.request.get('/api/auth/get-session')).json()).toBeNull();

    await page.goto('/sign-in');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Entrar a mi casa' }).click();
    await expect(page.getByRole('heading', { name: 'Verificá tu correo' })).toBeVisible();
    const signedIn = await (await page.request.get('/api/auth/get-session')).json();
    expect(signedIn.user.id).toBe(userId);
    await page.screenshot({ path: 'test-results/neon-live-verification.png' });
    console.log('Neon real: registro, login, sesión y logout correctos; la vivienda deniega cuentas sin verificar.');
  } finally {
    // This account belongs only to this test. No real resident accounts are modified.
    if (userId) {
      expect(userId).toMatch(/^[a-zA-Z0-9-]+$/);
      await run(process.platform === 'win32' ? 'neon.cmd' : 'neon', ['neon-auth', 'user', 'delete', userId, '--project-id', 'broad-meadow-57190517', '--branch', 'production'], { shell: process.platform === 'win32', timeout: 30_000 });
      console.log('Cuenta sintética de prueba eliminada.');
    }
  }
});
