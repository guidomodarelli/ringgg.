import { HOMES } from '@/constants/homes';
import type { PosterLayoutRules, PosterTitleSize } from '@/types/poster';

/**
 * The door poster prints on a 10 × 15 cm sheet, the size of the sticker paper that photo printers and
 * printing kiosks take. The page, its print and the PDF of the installed iPhone app share this size.
 */
export const POSTER_SHEET = { widthMm: 100, heightMm: 150 };

/**
 * The layout of the sheet, in percents of its width: `cqw` on screen and in print (where 1cqw is 1mm),
 * pixels when the installed iPhone app draws the PDF. The text is large so it reads from the doorstep.
 */
export const POSTER_LAYOUT = {
  paddingX: 7,
  paddingY: 7,
  gap: 2.6,
  eyebrow: { typeface: 'body', weight: 600, size: 3.6, lineHeight: 1.2, tracking: 0.18, ink: 'accentDark' },
  title: { typeface: 'heading', weight: 650, lineHeight: 1.05, tracking: -0.02, ink: 'ink' },
  qrMaxSize: 68,
  steps: { typeface: 'body', weight: 500, size: 4.3, lineHeight: 1.28, tracking: 0, ink: 'ink', indent: 6.5, gap: 1, markerGap: 0.3 },
  note: { typeface: 'body', weight: 400, size: 3.6, lineHeight: 1.3, tracking: 0, ink: 'muted' },
  brand: { typeface: 'heading', weight: 700, size: 6, lineHeight: 1.1, tracking: 0, ink: 'ink' },
} satisfies PosterLayoutRules;

/** Short names fill the line; the longest a home can have still fits in two lines. */
export const POSTER_TITLE_SIZES = [
  { maxLength: 12, size: 11 },
  { maxLength: 20, size: 9 },
  { maxLength: 32, size: 7.5 },
  { maxLength: HOMES.nameMaxLength, size: 6 },
] satisfies PosterTitleSize[];

/** The poster's QR, the same on the page and in the PDF. */
export const POSTER_QR = { margin: 1, errorCorrectionLevel: 'M', dark: '#252a28', light: '#ffffff' } as const;

/** Text of the poster for a visitor who has never seen Ringgg; the home name goes between the eyebrow and the QR. */
export const POSTER_COPY = {
  eyebrow: 'TIMBRE DIGITAL',
  /** Ends the home name, in the accent color. */
  titleEnd: '.',
  steps: ['Abrí la cámara del celular y apuntá al código.', 'Tocá el enlace y después «Tocar timbre».', 'Esperá la respuesta en la misma pantalla.'],
  note: 'No hace falta instalar nada ni registrarse.',
  brand: 'ringgg.',
};

/** The PDF the installed iPhone app shares, where the page cannot print. */
export const POSTER_PDF = {
  fileName: 'ringgg-cartel.pdf',
  /** Print resolution of the poster image inside the PDF. */
  dotsPerInch: 300,
  /** JPEG quality of that image: high enough that the QR edges stay sharp. */
  jpegQuality: 0.95,
};
