import { test, expect, type Page } from '@playwright/test';
import { BOTTOM_NAV_HEIGHT_PX, SIDE_RAIL_WIDTH_PX, type SafeAreaInsets, boxOf, openPanelShell, startPanelShell } from './support/panel-shell';

/**
 * Chromium can report safe areas like an iPhone does, through the DevTools protocol, so `env()` reaches
 * the panel's tokens for real here; safe-areas.spec.ts measures the layout in WebKit.
 */
async function reportInsets(page: Page, insets: SafeAreaInsets) {
  const devtools = await page.context().newCDPSession(page);
  await devtools.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, ...insets } });
}

test.describe('con los insets que reporta el dispositivo', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('la barra inferior de un celular en vertical suma el home indicator', async ({ page }) => {
    const panel = await startPanelShell();
    try {
      const homeIndicator = { right: 0, bottom: 34, left: 0 };
      await reportInsets(page, homeIndicator);
      await openPanelShell(page, panel.url);
      expect((await boxOf(page.locator('.sidebar'))).height).toBe(BOTTOM_NAV_HEIGHT_PX + homeIndicator.bottom);
    } finally { await panel.close(); }
  });
});

/** An iPhone 13 in landscape with `viewport-fit=cover`: the whole screen, notch included. */
const LANDSCAPE_VIEWPORT = { width: 844, height: 390 };

test.describe('con los insets que reporta el dispositivo en horizontal', () => {
  test.use({ viewport: LANDSCAPE_VIEWPORT });

  test('el riel lateral suma la notch y el contenido la evita del otro lado', async ({ page }) => {
    const panel = await startPanelShell();
    try {
      const notch = { right: 47, bottom: 21, left: 47 };
      await reportInsets(page, notch);
      await openPanelShell(page, panel.url);
      expect((await boxOf(page.locator('.sidebar'))).width).toBe(SIDE_RAIL_WIDTH_PX.iconsOnly + notch.left);
      expect((await boxOf(page.getByRole('button', { name: 'Salir' }))).right).toBeLessThanOrEqual(LANDSCAPE_VIEWPORT.width - notch.right);
    } finally { await panel.close(); }
  });
});

test('la app declara un viewport que llega a los bordes de la pantalla', async ({ page }) => {
  // A public page is enough: every route shares the viewport of the root layout.
  await page.goto('/privacidad');
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
});
