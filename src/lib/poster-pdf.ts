import QRCode from 'qrcode';
import { POSTER_PDF, POSTER_QR, POSTER_SHEET } from '@/constants/poster';
import { jpegPagePdf } from '@/lib/pdf';
import { layoutPoster, type MeasureText } from '@/lib/poster-layout';
import type { PosterFont, PosterInk, PosterLine, PosterTypeface } from '@/types/poster';

/** The app's color tokens behind each poster ink, so the PDF uses the page's colors. */
const INK_TOKENS: Record<PosterInk, string> = { ink: '--ink', accent: '--accent', accentDark: '--accent-dark', muted: '--muted' };
/** The app's font tokens behind each typeface role. */
const TYPEFACE_TOKENS: Record<PosterTypeface, string> = { heading: '--heading', body: '--font' };
const MM_PER_INCH = 25.4;

/** The CSS `font` shorthand of a poster font. */
function cssFont(font: PosterFont, families: Record<PosterTypeface, string>) {
  return `${font.weight} ${font.size}px ${families[font.typeface]}`;
}

/** Canvas `letterSpacing` is recent; where it is missing the text is drawn and measured without tracking. */
function setTracking(context: CanvasRenderingContext2D, tracking: number) {
  if ('letterSpacing' in context) context.letterSpacing = `${tracking}px`;
}

/** Where a line of `width` pixels starts, given where it is anchored. */
function lineStart(line: PosterLine, width: number) {
  if (line.align === 'center') return line.x - width / 2;
  if (line.align === 'right') return line.x - width;
  return line.x;
}

function drawLine(context: CanvasRenderingContext2D, line: PosterLine, families: Record<PosterTypeface, string>, inks: Record<PosterInk, string>) {
  context.font = cssFont(line.font, families);
  setTracking(context, line.font.tracking);
  const widths = line.runs.map((run) => context.measureText(run.text).width);
  let x = lineStart(line, widths.reduce((sum, width) => sum + width, 0));
  line.runs.forEach((run, index) => {
    context.fillStyle = inks[run.ink];
    context.fillText(run.text, x, line.y);
    x += widths[index];
  });
}

/** The QR as square modules on white, snapped to whole pixels so the printer gets clean edges. */
function drawQr(context: CanvasRenderingContext2D, url: string, box: { x: number; y: number; size: number }) {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: POSTER_QR.errorCorrectionLevel });
  const cells = modules.size + 2 * POSTER_QR.margin;
  const edge = (cell: number) => Math.round(cell * (box.size / cells));
  const left = Math.round(box.x);
  const top = Math.round(box.y);
  context.fillStyle = POSTER_QR.light;
  context.fillRect(left, top, edge(cells), edge(cells));
  context.fillStyle = POSTER_QR.dark;
  for (let row = 0; row < modules.size; row += 1) {
    for (let column = 0; column < modules.size; column += 1) {
      if (!modules.get(row, column)) continue;
      const x = edge(column + POSTER_QR.margin);
      const y = edge(row + POSTER_QR.margin);
      context.fillRect(left + x, top + y, edge(column + POSTER_QR.margin + 1) - x, edge(row + POSTER_QR.margin + 1) - y);
    }
  }
}

async function canvasJpeg(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((resolve) => { canvas.toBlob(resolve, 'image/jpeg', POSTER_PDF.jpegQuality); });
  if (!blob) throw new Error(`PosterPdf:canvas.toBlob returned no JPEG for a ${canvas.width}×${canvas.height} canvas`);
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * The poster as a PDF of the sticker sheet, for the installed iPhone app, which ignores `window.print()`.
 * It draws the same layout as the page with the page's fonts and colors, at print resolution.
 */
export async function buildPosterPdf({ homeName, url }: { homeName: string; url: string }) {
  const tokens = getComputedStyle(document.documentElement);
  const token = (name: string) => tokens.getPropertyValue(name).trim();
  const families: Record<PosterTypeface, string> = { heading: token(TYPEFACE_TOKENS.heading), body: token(TYPEFACE_TOKENS.body) };
  const inks = Object.fromEntries(Object.entries(INK_TOKENS).map(([ink, name]) => [ink, token(name)])) as Record<PosterInk, string>;
  const pixelsPerMm = POSTER_PDF.dotsPerInch / MM_PER_INCH;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(POSTER_SHEET.widthMm * pixelsPerMm);
  canvas.height = Math.round(POSTER_SHEET.heightMm * pixelsPerMm);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PosterPdf:canvas 2D context unavailable');
  const measure: MeasureText = (text, font) => {
    context.font = cssFont(font, families);
    setTracking(context, font.tracking);
    return context.measureText(text).width;
  };
  const layout = layoutPoster({ homeName, width: canvas.width, height: canvas.height, measure });
  // A font the page has not used yet would draw in the fallback face: every one the poster uses loads first.
  // Without them (offline, Google Fonts blocked) the poster still draws, in the fallback face.
  await Promise.all([...new Set(layout.lines.map((line) => cssFont(line.font, families)))].map((font) => document.fonts.load(font).catch(() => [])));
  const drawn = layoutPoster({ homeName, width: canvas.width, height: canvas.height, measure });
  context.fillStyle = POSTER_QR.light;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textBaseline = 'middle';
  for (const line of drawn.lines) drawLine(context, line, families, inks);
  drawQr(context, url, drawn.qr);
  const jpeg = await canvasJpeg(canvas);
  return new File([jpegPagePdf(jpeg, canvas, POSTER_SHEET)], POSTER_PDF.fileName, { type: 'application/pdf' });
}
