import { describe, expect, it } from 'vitest';
import { HOMES } from '@/constants/homes';
import { POSTER_COPY, POSTER_LAYOUT, POSTER_SHEET } from '@/constants/poster';
import { layoutPoster, posterStyle, posterTitleSize, wrapBalanced, wrapText, type MeasureText } from '@/lib/poster-layout';
import type { PosterFont, PosterLine } from '@/types/poster';

/** A monospaced stand-in for the canvas: every grapheme is 0.55 em wide plus its tracking. */
const measure: MeasureText = (text, font) => Array.from(new Intl.Segmenter().segment(text)).length * (font.size * 0.55 + font.tracking);
const FONT: PosterFont = { typeface: 'body', weight: 400, size: 10, tracking: 0 };
/** The sheet at 300 dpi, as the installed iPhone app draws it. */
const SHEET = { width: 1181, height: 1772 };

const lineText = (line: PosterLine) => line.runs.map((run) => run.text).join('');
const lineWidth = (line: PosterLine) => measure(lineText(line), line.font);
function lineLeft(line: PosterLine) {
  if (line.align === 'center') return line.x - lineWidth(line) / 2;
  if (line.align === 'right') return line.x - lineWidth(line);
  return line.x;
}

describe('posterTitleSize', () => {
  it('makes the home name smaller the longer it is', () => {
    const sizes = ['Casa', 'Casa del patio', 'Departamento del fondo, 2.º B', 'x'.repeat(HOMES.nameMaxLength)].map(posterTitleSize);
    expect(sizes).toEqual([...sizes].sort((first, second) => second - first));
    expect(new Set(sizes).size).toBe(sizes.length);
  });
});

describe('posterStyle', () => {
  it('gives the page the sheet size and the same lengths the PDF uses', () => {
    const style = posterStyle('Casa');
    expect(style['--poster-sheet-width']).toBe(`${POSTER_SHEET.widthMm}mm`);
    expect(style['--poster-sheet-height']).toBe(`${POSTER_SHEET.heightMm}mm`);
    expect(style['--poster-aspect']).toBe(`${POSTER_SHEET.widthMm} / ${POSTER_SHEET.heightMm}`);
    expect(style['--poster-title-size']).toBe(`${posterTitleSize('Casa')}cqw`);
    expect(style['--poster-steps-size']).toBe(`${POSTER_LAYOUT.steps.size}cqw`);
    expect(style['--poster-qr-max']).toBe(`${POSTER_LAYOUT.qrMaxSize}cqw`);
  });
});

describe('wrapText', () => {
  it('breaks between words without losing any', () => {
    const lines = wrapText('Abrí la cámara del celular y apuntá al código.', 120, FONT, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('Abrí la cámara del celular y apuntá al código.');
    for (const line of lines) expect(measure(line, FONT)).toBeLessThanOrEqual(120);
  });

  it('breaks a word longer than the line inside it, never inside an emoji', () => {
    const lines = wrapText('Casa👨‍👩‍👧Superlargadelacuadra', 55, FONT, measure);
    expect(lines.join('')).toBe('Casa👨‍👩‍👧Superlargadelacuadra');
    expect(lines.some((line) => line.includes('👨‍👩‍👧'))).toBe(true);
    for (const line of lines) expect(measure(line, FONT)).toBeLessThanOrEqual(55);
  });
});

describe('wrapBalanced', () => {
  it('keeps the lines of the greedy wrap but evens them, so no word is left alone on the last one', () => {
    const text = 'Abrí la cámara del celular y apuntá al código.';
    const greedy = wrapText(text, 230, FONT, measure);
    const balanced = wrapBalanced(text, 230, FONT, measure);
    expect(balanced).toHaveLength(greedy.length);
    expect(balanced.join(' ')).toBe(text);
    const spread = (lines: string[]) => Math.max(...lines.map((line) => measure(line, FONT))) - Math.min(...lines.map((line) => measure(line, FONT)));
    expect(spread(balanced)).toBeLessThan(spread(greedy));
    for (const line of balanced) expect(measure(line, FONT)).toBeLessThanOrEqual(230);
  });

  it('leaves a text that fits in one line as it is', () => {
    expect(wrapBalanced('ringgg.', 230, FONT, measure)).toEqual(['ringgg.']);
  });
});

describe('layoutPoster', () => {
  const homeNames = ['Casa', 'Departamento del fondo, 2.º B', 'x'.repeat(HOMES.nameMaxLength)];

  it.each(homeNames)('keeps everything inside the margins of the sheet for «%s»', (homeName) => {
    const { lines, qr } = layoutPoster({ homeName, ...SHEET, measure });
    const unit = SHEET.width / 100;
    for (const line of lines) {
      expect(lineLeft(line)).toBeGreaterThanOrEqual(POSTER_LAYOUT.paddingX * unit - 1);
      expect(lineLeft(line) + lineWidth(line)).toBeLessThanOrEqual(SHEET.width - POSTER_LAYOUT.paddingX * unit + 1);
      expect(line.y).toBeGreaterThan(POSTER_LAYOUT.paddingY * unit);
      expect(line.y).toBeLessThan(SHEET.height - POSTER_LAYOUT.paddingY * unit);
    }
    expect(qr.x).toBeGreaterThanOrEqual(POSTER_LAYOUT.paddingX * unit);
    expect(qr.x + qr.size).toBeLessThanOrEqual(SHEET.width - POSTER_LAYOUT.paddingX * unit);
  });

  it.each(homeNames)('fills the sheet top to bottom with a large QR for «%s»', (homeName) => {
    const { lines, qr } = layoutPoster({ homeName, ...SHEET, measure });
    const unit = SHEET.width / 100;
    const last = lines.at(-1)!;
    expect(lineText(last)).toBe(POSTER_COPY.brand);
    // The brand ends at the bottom padding: the QR took all the height the text left.
    expect(last.y + (last.font.size * POSTER_LAYOUT.brand.lineHeight) / 2).toBeCloseTo(SHEET.height - POSTER_LAYOUT.paddingY * unit, 0);
    expect(qr.size).toBeGreaterThan(SHEET.width / 2);
    expect(qr.size).toBeLessThanOrEqual(POSTER_LAYOUT.qrMaxSize * unit);
  });

  it('stacks the eyebrow and the name above the QR and the steps, note and brand below it', () => {
    const { lines, qr } = layoutPoster({ homeName: 'Casa del patio', ...SHEET, measure });
    const texts = lines.map(lineText);
    const above = lines.filter((line) => line.y < qr.y).map(lineText);
    expect(above).toEqual([POSTER_COPY.eyebrow, `Casa del patio${POSTER_COPY.titleEnd}`]);
    expect(texts).toEqual(expect.arrayContaining(['1.', '2.', '3.', POSTER_COPY.note, POSTER_COPY.brand]));
    for (const line of lines.filter((candidate) => candidate.y > qr.y)) expect(line.y).toBeGreaterThan(qr.y + qr.size);
  });

  it('paints the period that ends the home name in the accent color', () => {
    const { lines } = layoutPoster({ homeName: 'Departamento del fondo, 2.º B', ...SHEET, measure });
    const title = lines.filter((line) => line.font.typeface === 'heading' && lineText(line) !== POSTER_COPY.brand);
    expect(title.length).toBeGreaterThan(1);
    expect(title.at(-1)!.runs.at(-1)).toEqual({ text: POSTER_COPY.titleEnd, ink: 'accent' });
    expect(title.slice(0, -1).flatMap((line) => line.runs).every((run) => run.ink === 'ink')).toBe(true);
  });
});
