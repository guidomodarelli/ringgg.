import { POSTER_COPY, POSTER_LAYOUT, POSTER_SHEET, POSTER_TITLE_SIZES } from '@/constants/poster';
import type { PosterFont, PosterLayout, PosterLine, PosterRun, PosterTextStyle } from '@/types/poster';

/** Width in pixels of a text in a font, as the canvas that draws the poster measures it. */
export type MeasureText = (text: string, font: PosterFont) => number;

/** Percents of the sheet width the home name takes as its size: smaller the longer the name. */
export function posterTitleSize(homeName: string) {
  const length = Array.from(homeName).length;
  return (POSTER_TITLE_SIZES.find((step) => length <= step.maxLength) ?? POSTER_TITLE_SIZES[POSTER_TITLE_SIZES.length - 1]).size;
}

/**
 * The layout of the sheet as CSS custom properties of `.poster-sheet`: the page and its print read the
 * same rules the installed iPhone app draws the PDF with.
 */
export function posterStyle(homeName: string): Record<`--poster-${string}`, string> {
  const cqw = (percent: number) => `${percent}cqw`;
  const text = (name: string, style: Omit<PosterTextStyle, 'size'> & { size?: number }) => ({
    ...(style.size === undefined ? {} : { [`--poster-${name}-size`]: cqw(style.size) }),
    [`--poster-${name}-line-height`]: String(style.lineHeight),
    [`--poster-${name}-tracking`]: `${style.tracking}em`,
  });
  return {
    '--poster-sheet-width': `${POSTER_SHEET.widthMm}mm`,
    '--poster-sheet-height': `${POSTER_SHEET.heightMm}mm`,
    '--poster-aspect': `${POSTER_SHEET.widthMm} / ${POSTER_SHEET.heightMm}`,
    '--poster-padding': `${cqw(POSTER_LAYOUT.paddingY)} ${cqw(POSTER_LAYOUT.paddingX)}`,
    '--poster-gap': cqw(POSTER_LAYOUT.gap),
    '--poster-qr-max': cqw(POSTER_LAYOUT.qrMaxSize),
    '--poster-title-size': cqw(posterTitleSize(homeName)),
    '--poster-steps-indent': cqw(POSTER_LAYOUT.steps.indent),
    '--poster-steps-gap': cqw(POSTER_LAYOUT.steps.gap),
    ...text('eyebrow', POSTER_LAYOUT.eyebrow),
    ...text('title', POSTER_LAYOUT.title),
    ...text('steps', POSTER_LAYOUT.steps),
    ...text('note', POSTER_LAYOUT.note),
    ...text('brand', POSTER_LAYOUT.brand),
  };
}

/** Graphemes of a text, so a long word never breaks inside an emoji or an accented letter. */
function graphemes(text: string) {
  return Array.from(new Intl.Segmenter().segment(text), (part) => part.segment);
}

/** The longest start of a word that fits in the line, at least one grapheme so the wrap always advances. */
function splitToFit(word: string, maxWidth: number, font: PosterFont, measure: MeasureText): [string, string] {
  const parts = graphemes(word);
  let count = 1;
  while (count < parts.length && measure(parts.slice(0, count + 1).join(''), font) <= maxWidth) count += 1;
  return [parts.slice(0, count).join(''), parts.slice(count).join('')];
}

/** Breaks a text into lines that fit `maxWidth`, between words and, like `overflow-wrap: anywhere`, inside a word too long for a line. */
export function wrapText(text: string, maxWidth: number, font: PosterFont, measure: MeasureText) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, font) <= maxWidth) { line = candidate; continue; }
    if (line) lines.push(line);
    line = word;
    while (measure(line, font) > maxWidth) {
      const [head, rest] = splitToFit(line, maxWidth, font, measure);
      lines.push(head);
      line = rest;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Layout lengths are percents of the sheet width. */
const SHEET_WIDTH_PERCENT = 100;

/** Halvings of the line width while balancing: past this the lines change by less than a pixel. */
const BALANCE_STEPS = 12;

/**
 * Wraps like `text-wrap: balance` on the page: the same number of lines as `wrapText`, at the narrowest
 * width that keeps it, so a wrapped step never leaves one word alone on its last line.
 */
export function wrapBalanced(text: string, maxWidth: number, font: PosterFont, measure: MeasureText) {
  const lines = wrapText(text, maxWidth, font, measure);
  if (lines.length < 2) return lines;
  let narrow = 0;
  let wide = maxWidth;
  for (let step = 0; step < BALANCE_STEPS; step += 1) {
    const width = (narrow + wide) / 2;
    if (wrapText(text, width, font, measure).length <= lines.length) wide = width;
    else narrow = width;
  }
  return wrapText(text, wide, font, measure);
}

/** A block of lines measured before it gets its place on the sheet. */
interface TextBlock { height: number; place: (top: number) => PosterLine[] }

/**
 * Where every line and the QR go on a sheet of `width × height` pixels. The blocks stack from the top
 * like the page's flex column: eyebrow, home name, QR, steps, note and brand. The QR takes the height the
 * text leaves (up to its maximum side) and is centered in it, so the poster always fills the sheet.
 */
export function layoutPoster({ homeName, width, height, measure }: { homeName: string; width: number; height: number; measure: MeasureText }): PosterLayout {
  const unit = width / SHEET_WIDTH_PERCENT;
  const paddingX = POSTER_LAYOUT.paddingX * unit;
  const paddingY = POSTER_LAYOUT.paddingY * unit;
  const gap = POSTER_LAYOUT.gap * unit;
  const contentWidth = width - 2 * paddingX;
  const center = width / 2;
  const fontOf = (style: PosterTextStyle): PosterFont => ({ typeface: style.typeface, weight: style.weight, size: style.size * unit, tracking: style.tracking * style.size * unit });

  function centered(text: string, style: PosterTextStyle, runsOf: (line: string, index: number, lines: string[]) => PosterRun[] = (line) => [{ text: line, ink: style.ink }]): TextBlock {
    const font = fontOf(style);
    const lineHeight = font.size * style.lineHeight;
    const lines = wrapBalanced(text, contentWidth, font, measure);
    return {
      height: lines.length * lineHeight,
      place: (top) => lines.map((line, index) => ({ runs: runsOf(line, index, lines), font, x: center, y: top + index * lineHeight + lineHeight / 2, align: 'center' })),
    };
  }

  function steps(): TextBlock {
    const style = POSTER_LAYOUT.steps;
    const font = fontOf(style);
    const lineHeight = font.size * style.lineHeight;
    const textLeft = paddingX + style.indent * unit;
    // The number sits right of the indent with a space before the text, like the list markers of the page.
    const markerRight = textLeft - font.size * style.markerGap;
    const items = POSTER_COPY.steps.map((step) => wrapBalanced(step, contentWidth - style.indent * unit, font, measure));
    const itemGap = style.gap * unit;
    return {
      height: items.reduce((total, lines) => total + lines.length * lineHeight, 0) + itemGap * (items.length - 1),
      place: (top) => {
        let itemTop = top;
        return items.flatMap((lines, item) => {
          const placed: PosterLine[] = [
            { runs: [{ text: `${item + 1}.`, ink: style.ink }], font, x: markerRight, y: itemTop + lineHeight / 2, align: 'right' },
            ...lines.map((line, index): PosterLine => ({ runs: [{ text: line, ink: style.ink }], font, x: textLeft, y: itemTop + index * lineHeight + lineHeight / 2, align: 'left' })),
          ];
          itemTop += lines.length * lineHeight + itemGap;
          return placed;
        });
      },
    };
  }

  const titleStyle: PosterTextStyle = { ...POSTER_LAYOUT.title, size: posterTitleSize(homeName) };
  const titleEnd = POSTER_COPY.titleEnd;
  // The name ends in the accent period, which wraps with the last word like the page's `<span>`.
  const title = centered(`${homeName}${titleEnd}`, titleStyle, (line, index, lines) => index === lines.length - 1 && line.endsWith(titleEnd)
    ? [{ text: line.slice(0, -titleEnd.length), ink: titleStyle.ink }, { text: titleEnd, ink: 'accent' }]
    : [{ text: line, ink: titleStyle.ink }]);
  const above = [centered(POSTER_COPY.eyebrow, POSTER_LAYOUT.eyebrow), title];
  const below = [steps(), centered(POSTER_COPY.note, POSTER_LAYOUT.note), centered(POSTER_COPY.brand, POSTER_LAYOUT.brand)];
  const textHeight = [...above, ...below].reduce((total, block) => total + block.height, 0);
  const blockCount = above.length + 1 + below.length;
  const qrSlot = Math.max(0, height - 2 * paddingY - textHeight - gap * (blockCount - 1));
  const qrSize = Math.min(qrSlot, POSTER_LAYOUT.qrMaxSize * unit, contentWidth);

  const lines: PosterLine[] = [];
  let top = paddingY;
  for (const block of above) { lines.push(...block.place(top)); top += block.height + gap; }
  const qr = { x: center - qrSize / 2, y: top + (qrSlot - qrSize) / 2, size: qrSize };
  top += qrSlot + gap;
  for (const block of below) { lines.push(...block.place(top)); top += block.height + gap; }
  return { lines, qr };
}
