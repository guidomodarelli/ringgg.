import { test, expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { POSTER_PDF, POSTER_SHEET } from '../../src/constants/poster';
import { bundleFixture } from './support/bundle-fixture';

/** PDF points of the sticker sheet, 72 per inch. */
const SHEET_POINTS = { width: (POSTER_SHEET.widthMm * 72) / 25.4, height: (POSTER_SHEET.heightMm * 72) / 25.4 };
/** CSS pixels of the sheet when the page is printed, 96 per inch. */
const SHEET_PIXELS = { width: (POSTER_SHEET.widthMm * 96) / 25.4, height: (POSTER_SHEET.heightMm * 96) / 25.4 };
/** A short name and one as long as a home name can be. */
const HOME_NAMES = ['Casa del patio', 'Departamento del fondo con jardín y parrilla 2.º B'];
/** Chromium prints whole CSS pixels, so the page can differ from the sheet by up to one point. */
const PAGE_TOLERANCE_POINTS = 1;

type SharedFile = { name: string; type: string; bytes: number[] };
type RecordingWindow = Window & { __sharedFiles: SharedFile[]; __printCalls: number };

/** The real poster view, print button and stylesheet, outside the app: the page itself needs a signed-in resident. */
async function startPosterFixture() {
  const bundled = await bundleFixture('tests/fixtures/poster-entry.tsx');
  const css = readFileSync('src/app/globals.css', 'utf8');
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html lang="es-AR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Poster fixture server did not expose a port');
  return {
    url: (homeName: string) => `http://127.0.0.1:${address.port}/?name=${encodeURIComponent(homeName)}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

/**
 * Records what the button hands to the browser: `window.print()` calls and the files of the share sheet.
 * The iOS share sheet and WebKit's standalone mode cannot run in Playwright, so with `installed` the page
 * sees the navigator of the app installed from Safari, and the share sheet only keeps the file it would open.
 */
async function recordPrinting(page: Page, { installed }: { installed: boolean }) {
  await page.addInitScript((standalone) => {
    const recording = window as unknown as RecordingWindow;
    recording.__sharedFiles = [];
    recording.__printCalls = 0;
    window.print = () => { recording.__printCalls += 1; };
    if (!standalone) return;
    Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true });
    navigator.canShare = (data) => Boolean(data?.files?.length);
    navigator.share = async (data) => {
      for (const file of data?.files ?? []) recording.__sharedFiles.push({ name: file.name, type: file.type, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
    };
  }, installed);
}

const recorded = (page: Page) => page.evaluate(() => {
  const recording = window as unknown as RecordingWindow;
  return { printCalls: recording.__printCalls, sharedFiles: recording.__sharedFiles.length };
});

/** Width and height in points of the first page of a PDF. */
function mediaBox(pdf: Uint8Array) {
  const match = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(Buffer.from(pdf).toString('latin1'));
  return { width: Number(match?.[1]), height: Number(match?.[2]) };
}

/** The PDFs land in `test-results/` so a person can open them and look at the poster. */
function saveForInspection(name: string, bytes: Uint8Array) {
  mkdirSync('test-results', { recursive: true });
  writeFileSync(`test-results/${name}`, bytes);
}

let fixture: Awaited<ReturnType<typeof startPosterFixture>>;
test.beforeAll(async () => { fixture = await startPosterFixture(); });
test.afterAll(async () => { await fixture.close(); });

for (const [index, homeName] of HOME_NAMES.entries()) {
  test(`en el navegador imprime «${homeName}» en una sola hoja de 10 × 15 cm que el cartel ocupa entera`, async ({ page }) => {
    await recordPrinting(page, { installed: false });
    await page.goto(fixture.url(homeName));
    const button = page.getByRole('button', { name: 'Imprimir o guardar PDF' });
    await expect(button).toBeEnabled();
    await button.click();
    expect(await recorded(page)).toEqual({ printCalls: 1, sharedFiles: 0 });

    await page.evaluate(async () => { await document.fonts.ready; });
    const printed = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    saveForInspection(`ringgg-cartel-impreso-${index + 1}.pdf`, printed);
    expect(Buffer.from(printed).toString('latin1').match(/\/Type\s*\/Page\b/g), 'printed pages').toHaveLength(1);
    expect(Math.abs(mediaBox(printed).width - SHEET_POINTS.width)).toBeLessThan(PAGE_TOLERANCE_POINTS);
    expect(Math.abs(mediaBox(printed).height - SHEET_POINTS.height)).toBeLessThan(PAGE_TOLERANCE_POINTS);

    // Printed, the sheet is the whole page and the poster reaches from its top to its bottom, with a large QR.
    await page.emulateMedia({ media: 'print' });
    const sheet = (await page.locator('.poster-sheet').boundingBox())!;
    expect(sheet.x).toBeCloseTo(0, 0);
    expect(sheet.y).toBeCloseTo(0, 0);
    expect(sheet.width).toBeCloseTo(SHEET_PIXELS.width, 0);
    expect(sheet.height).toBeCloseTo(SHEET_PIXELS.height, 0);
    const eyebrow = (await page.getByText('TIMBRE DIGITAL').boundingBox())!;
    const brand = (await page.locator('.poster-brand').boundingBox())!;
    const qr = (await page.getByRole('img', { name: `Código QR para tocar el timbre de ${homeName}` }).boundingBox())!;
    expect(eyebrow.y).toBeLessThan(sheet.height * 0.1);
    expect(brand.y + brand.height).toBeGreaterThan(sheet.height * 0.9);
    expect(brand.y + brand.height).toBeLessThanOrEqual(sheet.height);
    expect(qr.width).toBeGreaterThan(sheet.width / 2);
    await page.screenshot({ path: `test-results/ringgg-cartel-impreso-${index + 1}.png`, clip: sheet });
  });
}

test('en la app instalada del iPhone comparte el cartel como PDF de 10 × 15 cm, preparado antes del toque', async ({ page }) => {
  await recordPrinting(page, { installed: true });
  // The fonts wait until the test sees the button say that the PDF is being prepared.
  let releaseFonts = () => {};
  const fontsReleased = new Promise<void>((resolve) => { releaseFonts = resolve; });
  await page.route('https://fonts.gstatic.com/**', async (route) => { await fontsReleased; await route.continue(); });
  // The held fonts also hold the `load` event.
  await page.goto(fixture.url(HOME_NAMES[0]), { waitUntil: 'domcontentloaded' });
  const button = page.getByRole('button', { name: 'Imprimir o guardar PDF' });
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await expect(button).toBeDisabled();
  releaseFonts();
  await expect(button).toBeEnabled({ timeout: 15_000 });
  await expect(button).not.toHaveAttribute('aria-busy');
  await button.click();

  const shared = await page.waitForFunction(() => (window as unknown as RecordingWindow).__sharedFiles[0]).then((handle) => handle.jsonValue());
  expect((await recorded(page)).printCalls).toBe(0);
  expect(shared.name).toBe(POSTER_PDF.fileName);
  expect(shared.type).toBe('application/pdf');
  const pdf = Uint8Array.from(shared.bytes);
  saveForInspection('ringgg-cartel-iphone.pdf', pdf);
  const text = Buffer.from(pdf).toString('latin1');
  expect(text.startsWith('%PDF-')).toBe(true);
  expect(mediaBox(pdf).width).toBeCloseTo(SHEET_POINTS.width, 1);
  expect(mediaBox(pdf).height).toBeCloseTo(SHEET_POINTS.height, 1);
  expect(text).toContain('/Filter /DCTDecode');
  expect(text).toContain('\xff\xd8\xff');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('en la app instalada de un iPhone que no comparte archivos explica cómo imprimir', async ({ page }) => {
  await recordPrinting(page, { installed: true });
  await page.addInitScript(() => { navigator.canShare = () => false; });
  await page.goto(fixture.url(HOME_NAMES[0]));
  const button = page.getByRole('button', { name: 'Imprimir o guardar PDF' });
  await expect(button).toBeEnabled({ timeout: 15_000 });
  await button.click();
  await expect(page.getByRole('alert')).toHaveText('Este iPhone no deja imprimir desde la app instalada. Abrí ringgg en Safari para imprimir el cartel.');
  expect(await recorded(page)).toEqual({ printCalls: 0, sharedFiles: 0 });
});
