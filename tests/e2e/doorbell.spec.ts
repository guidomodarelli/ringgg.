import { test, expect, type Page } from '@playwright/test';

/**
 * The first visit to a home asks who you are (prefilled with the account name), then offers
 * notifications; these tests keep the suggested name and go on without notifications.
 */
async function enterHome(page: Page) {
  const nameDialog = page.getByRole('dialog', { name: '¿Quién sos?' });
  const skipNotifications = page.getByRole('button', { name: 'Seguir sin avisos en este dispositivo' });
  // After signing in, `next dev` may still be compiling the panel for the first time.
  await expect(nameDialog.or(skipNotifications)).toBeVisible({ timeout: 30_000 });
  if (await nameDialog.isVisible()) {
    await expect(nameDialog.getByLabel('Tu nombre')).not.toHaveValue('');
    await nameDialog.getByRole('button', { name: 'Guardar mi nombre' }).click();
    await expect(nameDialog).toHaveCount(0);
  }
  await skipNotifications.click();
}

const isDashboardRequest = (url: URL | string) => new URL(url).pathname === '/api/dashboard';

test('un visitante toca el QR y recibe la respuesta del residente; los ajustes revocan el enlace', async ({ page, browser }) => {
  test.skip(!process.env.E2E_NEON_AUTH_EMAIL || !process.env.E2E_NEON_AUTH_PASSWORD, 'Requiere un residente real verificado de Neon; nunca se simula el proveedor.');
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(process.env.E2E_NEON_AUTH_EMAIL!);
  await page.getByLabel('Contraseña', { exact: true }).fill('incorrecta');
  await page.getByRole('button', { name: 'Entrar a mi casa' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'no son correctos' })).toBeVisible();
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.E2E_NEON_AUTH_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar a mi casa' }).click();
  await enterHome(page);
  await expect(page.getByRole('heading', { name: 'Tu casa te llama.' })).toBeVisible();
  const publicUrl = await page.getByRole('link', { name: 'Ver mi timbre' }).getAttribute('href');
  expect(publicUrl).toContain('/t/');
  await page.getByRole('link', { name: 'Mi código QR', exact: true }).click();
  await expect(page.getByAltText(/QR para tocar/)).toBeVisible();
  await page.screenshot({ path: 'test-results/ringgg-desktop.png', fullPage: true });
  // The poster of this home renders on the server, with the same QR, and goes back to the panel.
  await page.getByRole('link', { name: 'Imprimir cartel para la puerta' }).click();
  await expect(page).toHaveURL(/\/cartel\?home=\d+$/);
  await expect(page.getByRole('img', { name: /^Código QR para tocar el timbre de / })).toBeVisible();
  await page.goBack();
  await expect(page.getByAltText(/QR para tocar/)).toBeVisible();
  const visitorContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const visitor = await visitorContext.newPage();
  await visitor.goto(publicUrl!);
  await visitor.getByLabel('¿Querés decir quién sos?').fill('Soy Juan, del delivery');
  await visitor.screenshot({ path: 'test-results/ringgg-visitor-mobile.png', fullPage: true });
  await visitor.getByRole('button', { name: 'Tocar timbre', exact: true }).dblclick();
  await expect(visitor.getByRole('heading', { name: '¡Ding, dong!' })).toBeVisible();
  await expect(visitor.getByText('Tu timbrazo quedó registrado, pero no pudimos enviar una notificación.')).toBeVisible();
  // Without push on this browser the panel would see the ring on its next check; focusing it checks now.
  // A check that already saw the ring names the link «Timbrazos, 1 por responder».
  await page.getByRole('link', { name: /^Timbrazos(, \d+ por responder)?$/ }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Soy Juan, del delivery' })).toBeVisible({ timeout: 15_000 });
  await visitor.clock.install();
  await visitor.clock.pauseAt(new Date());
  await page.getByRole('button', { name: 'Ya voy', exact: true }).click();
  await visitor.clock.fastForward(121_000);
  await expect(visitor.getByRole('heading', { name: '¡Ya van!' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Atendido', { exact: true })).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/ringgg-resident-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Configuración', exact: true }).click();
  await page.getByRole('button', { name: 'Pausar timbre', exact: true }).click();
  await expect(page.getByText('Mientras el timbre esté pausado', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Hasta que lo reactive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Activar timbre', exact: true })).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByRole('heading', { name: 'El timbre está en pausa' })).toBeVisible();
  await page.getByRole('button', { name: 'Activar timbre', exact: true }).click();
  await page.getByRole('link', { name: 'Mi código QR', exact: true }).click();
  await page.getByRole('button', { name: 'Regenerar QR', exact: true }).click();
  await page.getByRole('button', { name: 'Sí, crear nuevo QR' }).click();
  await expect(page.getByText('Nuevo QR creado.', { exact: false })).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByRole('heading', { name: '¿Otra puerta?' })).toBeVisible();
  await visitorContext.close();
});

test('una respuesta vieja no pisa el nombre confirmado y el shell conserva el nombre actualizado', async ({ page }) => {
  test.skip(!process.env.E2E_NEON_AUTH_EMAIL || !process.env.E2E_NEON_AUTH_PASSWORD, 'Requiere una sesión real del proveedor Neon.');
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(process.env.E2E_NEON_AUTH_EMAIL!);
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.E2E_NEON_AUTH_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar a mi casa' }).click();
  await enterHome(page);
  await expect(page.getByRole('heading', { name: 'Tu casa te llama.' })).toBeVisible();
  await page.getByRole('link', { name: 'Configuración', exact: true }).click();
  let release!: () => void;
  let captured!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const capturedResponse = new Promise<void>((resolve) => { captured = resolve; });
  let first = true;
  await page.route(isDashboardRequest, async (route) => {
    if (!first) { await route.continue(); return; }
    first = false;
    const response = await route.fetch();
    captured();
    await held;
    await route.fulfill({ response });
  });
  // Regaining focus refreshes right away instead of waiting for the idle cadence.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await capturedResponse;
  await page.getByLabel('Nombre de tu casa').fill('Casa del patio');
  await page.getByRole('button', { name: 'Guardar nombre' }).click();
  await expect(page.getByText('Nombre actualizado.', { exact: true })).toBeVisible();
  const delayed = page.waitForResponse((response) => isDashboardRequest(response.url()));
  release();
  await delayed;
  await expect(page.locator('.qr-home')).toHaveText('Casa del patio');
  await expect(page.locator('.house-selector strong')).toHaveText('Casa del patio');
  await page.reload();
  await expect(page.locator('.qr-home')).toHaveText('Casa del patio');
});

test('la API privada exige sesión y bloquea mutaciones de otro origen', async ({ request, page }) => {
  const unauthenticated = await request.get('/api/dashboard');
  expect([401, 503]).toContain(unauthenticated.status());
  for (const path of ['/api/settings', '/api/pause', '/api/rename-device', '/api/subscribe', '/api/push-receipt', '/api/homes', '/api/delete-home', '/api/renew-subscription', '/api/residents']) {
    const foreign = await request.post(path, { headers: { origin: 'https://otro-sitio.example' }, data: { name: 'Ajena', mode: 'indefinite' } });
    expect(foreign.status(), path).toBe(403);
  }
  const cron = await request.get('/api/cron/purge');
  expect([401, 503]).toContain(cron.status());
  // With auth configured the proxy answers 307; without it (Dependabot and forks get no secrets) the page
  // redirects while streaming. Either way the poster is never shown without a session.
  await page.goto('/cartel');
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.locator('.qr-home')).toHaveCount(0);
  // The privacy policy is public: no session and no redirect, as the OAuth consent screen requires.
  const privacy = await request.get('/privacidad', { maxRedirects: 0 });
  expect(privacy.status()).toBe(200);
  expect(await privacy.text()).toContain('Política de privacidad');
  // Open apps compare this value to notice a new deployment: public, fresh and the same on every read.
  const firstVersion = await request.get('/api/version');
  expect(firstVersion.headers()['cache-control']).toContain('no-store');
  const { version } = await firstVersion.json() as { version: string };
  expect(version).not.toBe('');
  expect(await (await request.get('/api/version')).json()).toEqual({ version });
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  expect((await manifest.json()).display).toBe('standalone');
  const icon = await request.get('/icons/icon-192.png');
  expect(icon.headers()['content-type']).toContain('image/png');
});

test('las páginas de la app pueden leer la ubicación del dispositivo, como pide tocar desde la puerta', async ({ page, context, baseURL }) => {
  const door = { latitude: -34.6037, longitude: -58.3816 };
  await context.grantPermissions(['geolocation'], { origin: baseURL });
  await context.setGeolocation({ ...door, accuracy: 10 });
  // A public page is enough: the response policy is the same on every route the app serves.
  await page.goto('/privacidad');
  const reading = await page.evaluate(() => new Promise<{ latitude: number; longitude: number } | string>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { resolve({ latitude: coords.latitude, longitude: coords.longitude }); },
      (error) => { resolve(`geolocation failed with code ${error.code}: ${error.message}`); },
    );
  }));
  expect(reading).toEqual(door);
});
