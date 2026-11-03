/** Typeface roles of the poster: the app's heading font and its body font. */
export type PosterTypeface = 'heading' | 'body';

/** Colors of the poster, named after the app's color tokens. */
export type PosterInk = 'ink' | 'accent' | 'accentDark' | 'muted';

/** A text style of the poster. Sizes are percents of the sheet width; tracking is in `em`. */
export interface PosterTextStyle {
  typeface: PosterTypeface;
  weight: number;
  size: number;
  lineHeight: number;
  tracking: number;
  ink: PosterInk;
}

/** The poster's layout, every length in percents of the sheet width (`cqw` on screen and in print). */
export interface PosterLayoutRules {
  paddingX: number;
  paddingY: number;
  /** Space between the blocks of the poster. */
  gap: number;
  eyebrow: PosterTextStyle;
  /** The home name; its size depends on the name's length (`POSTER_TITLE_SIZES`). */
  title: Omit<PosterTextStyle, 'size'>;
  /** The QR takes the room the text leaves, up to this side. */
  qrMaxSize: number;
  /** `indent` is where the text starts and `gap` the space between steps; `markerGap`, in `em`, is the space after each number. */
  steps: PosterTextStyle & { indent: number; gap: number; markerGap: number };
  note: PosterTextStyle;
  brand: PosterTextStyle;
}

/** A title size for the names up to `maxLength` characters. */
export interface PosterTitleSize { maxLength: number; size: number }

/** A font as the poster draws it, in pixels. */
export interface PosterFont { typeface: PosterTypeface; weight: number; size: number; tracking: number }

/** A piece of a line in one color: the home name ends in the accent period. */
export interface PosterRun { text: string; ink: PosterInk }

/** A line of text positioned on the sheet; `y` is the middle of its line box. */
export interface PosterLine { runs: PosterRun[]; font: PosterFont; x: number; y: number; align: 'center' | 'left' | 'right' }

/** Where everything goes on a sheet of a given size in pixels. */
export interface PosterLayout { lines: PosterLine[]; qr: { x: number; y: number; size: number } }
