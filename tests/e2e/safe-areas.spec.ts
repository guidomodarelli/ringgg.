import { test, expect, devices, type Page } from '@playwright/test';
import {
  BOTTOM_NAV_HEIGHT_PX, NO_INSETS, SIDE_RAIL_WIDTH_PX, SUBPIXEL_TOLERANCE_PX, type SafeAreaInsets,
  boxOf, openPanelShell, scrollPageToEnd, scrollRailToEnd, sectionLinks, showPendingStatus, startPanelShell, viewportOf,
} from './support/panel-shell';

// WebKit lays the panel out like Safari on an iPhone (touch, device scale, its viewport).
test.use({ ...devices['iPhone 13'] });

/**
 * What an iPhone 13 reports through `env(safe-area-inset-*)`. WebKit outside an iPhone reports 0, so each
 * case sets the tokens that read `env()`; safe-areas-env.spec.ts checks those tokens against real insets.
 */
const IPHONE_PORTRAIT: SafeAreaInsets = { right: 0, bottom: 34, left: 0 };

/** Opens the panel with the device insets applied to its `--safe-area-*` tokens. */
async function openWithInsets(page: Page, url: string, insets: SafeAreaInsets) {
  await openPanelShell(page, url);
  await page.evaluate((values) => {
    for (const [side, pixels] of Object.entries(values)) document.documentElement.style.setProperty(`--safe-area-${side}`, `${pixels}px`);
  }, insets);
}

test.describe('en vertical, la barra inferior', () => {
  test('crece con el home indicator y deja visibles el contenido y el aviso de proceso', async ({ page }) => {
    const panel = await startPanelShell();
    try {
      await openWithInsets(page, panel.url, IPHONE_PORTRAIT);
      const viewport = viewportOf(page);
      const bar = await boxOf(page.locator('.sidebar'));
      expect(bar.bottom).toBe(viewport.height);
      expect(bar.height).toBe(BOTTOM_NAV_HEIGHT_PX + IPHONE_PORTRAIT.bottom);
      // The section links stay above the home indicator, where a tap does not trigger the system gesture.
      const homeIndicatorTop = viewport.height - IPHONE_PORTRAIT.bottom;
      for (const link of await sectionLinks(page)) expect((await boxOf(link)).bottom).toBeLessThanOrEqual(homeIndicatorTop);
      await scrollPageToEnd(page);
      expect((await boxOf(page.locator('.dashboard-footer'))).bottom).toBeLessThanOrEqual(bar.top + SUBPIXEL_TOLERANCE_PX);
      expect((await boxOf(await showPendingStatus(page))).bottom).toBeLessThanOrEqual(bar.top);
    } finally { await panel.close(); }
  });

  test('sin home indicator conserva su alto de siempre', async ({ page }) => {
    const panel = await startPanelShell();
    try {
      await openWithInsets(page, panel.url, NO_INSETS);
      const bar = await boxOf(page.locator('.sidebar'));
      expect(bar.height).toBe(BOTTOM_NAV_HEIGHT_PX);
      expect(bar.bottom).toBe(viewportOf(page).height);
    } finally { await panel.close(); }
  });
});

/**
 * Landscape viewports with `viewport-fit=cover`: the whole screen, notch included. The iPhone 13 gets the
 * icon-only rail; the Pro Max is wide enough for the labeled one and its bottom tip.
 */
const LANDSCAPE_PHONES = [
  { name: 'iPhone 13', viewport: { width: 844, height: 390 }, insets: { right: 47, bottom: 21, left: 47 }, railWidth: SIDE_RAIL_WIDTH_PX.iconsOnly },
  { name: 'iPhone 15 Pro Max', viewport: { width: 932, height: 430 }, insets: { right: 59, bottom: 21, left: 59 }, railWidth: SIDE_RAIL_WIDTH_PX.labeled },
];

for (const phone of LANDSCAPE_PHONES) {
  test.describe(`en horizontal en un ${phone.name}, el riel lateral`, () => {
    test.use({ viewport: phone.viewport });

    test('aleja los controles de la notch y del home indicator', async ({ page }) => {
      const panel = await startPanelShell();
      try {
        await openWithInsets(page, panel.url, phone.insets);
        const safeRight = phone.viewport.width - phone.insets.right;
        const safeBottom = phone.viewport.height - phone.insets.bottom;
        const rail = await boxOf(page.locator('.sidebar'));
        // The rail's background still fills the notch area; only its contents move.
        expect(rail.left).toBe(0);
        expect(rail.width).toBe(phone.railWidth + phone.insets.left);
        for (const link of await sectionLinks(page)) expect((await boxOf(link)).left).toBeGreaterThanOrEqual(phone.insets.left);
        await scrollRailToEnd(page);
        const lastLink = await boxOf(page.locator('.sidebar nav a').last());
        expect(lastLink.bottom).toBeLessThanOrEqual(safeBottom);
        if (phone.railWidth === SIDE_RAIL_WIDTH_PX.labeled) {
          const tip = await boxOf(page.locator('.sidebar-bottom'));
          expect(tip.left).toBeGreaterThanOrEqual(phone.insets.left);
          expect(tip.bottom).toBeLessThanOrEqual(safeBottom + SUBPIXEL_TOLERANCE_PX);
        }
        expect((await boxOf(page.getByRole('button', { name: 'Salir' }))).right).toBeLessThanOrEqual(safeRight);
        await scrollPageToEnd(page);
        expect((await boxOf(page.locator('.dashboard-footer'))).bottom).toBeLessThanOrEqual(safeBottom + SUBPIXEL_TOLERANCE_PX);
        const status = await boxOf(await showPendingStatus(page));
        expect(status.right).toBeLessThanOrEqual(safeRight);
        expect(status.bottom).toBeLessThanOrEqual(safeBottom);
      } finally { await panel.close(); }
    });

    test('sin notch conserva su ancho de siempre', async ({ page }) => {
      const panel = await startPanelShell();
      try {
        await openWithInsets(page, panel.url, NO_INSETS);
        expect((await boxOf(page.locator('.sidebar'))).width).toBe(phone.railWidth);
      } finally { await panel.close(); }
    });
  });
}
