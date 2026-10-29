import { test, expect } from '@playwright/test';

test('el acceso usa cuentas y muestra los flujos de registro, verificación y recuperación', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bienvenido a casa' })).toBeVisible();
  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  await expect(page.getByLabel('Contraseña', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Crear una cuenta' }).click();
  await expect(page.getByLabel('Tu nombre')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Creá tu cuenta' })).toBeVisible();
  await page.getByRole('button', { name: 'Volver a ingresar' }).click();
  await page.getByRole('button', { name: 'Olvidé mi contraseña' }).click();
  await expect(page.getByRole('button', { name: 'Enviar enlace' })).toBeVisible();
  await page.getByRole('button', { name: 'Volver a ingresar' }).click();
  await page.getByRole('button', { name: 'Verificar mi correo' }).click();
  await expect(page.getByLabel('Código de verificación')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pedir código nuevo' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('sin Neon configurado no se acepta la clave anterior ni una cookie local falsificada', async ({ page, request }) => {
  test.skip(Boolean(process.env.E2E_NEON_AUTH_EMAIL && process.env.E2E_NEON_AUTH_PASSWORD), 'El modo sin proveedor se prueba sin credenciales reales.');
  await page.goto('/');
  await expect(page.getByText('Falta conectar Neon Auth.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar a mi casa' })).toBeDisabled();
  const forged = await request.get('/api/dashboard', { headers: { cookie: 'ringgg-session=9999999999.forged-old-cookie' } });
  expect(forged.status()).toBe(503);
  const body = await forged.json();
  expect(body.code).toBe('AUTH_NOT_CONFIGURED');
  expect(body.home).toBeUndefined();
  const authProxy = await request.get('/api/auth/get-session');
  expect(authProxy.status()).toBe(503);
});
