export const DEVICES = {
  max: 10,
  nameMaxLength: 50,
  /** Base of the name a device with a generic one takes when its owner chooses their name: «Celular de Guido». */
  defaultName: 'Celular',
};

/** First match wins: iPad and iPhone before Mac, Android before Linux. */
export const DEVICE_PLATFORMS = [
  { pattern: /iPhone/i, label: 'iPhone' },
  { pattern: /iPad/i, label: 'iPad' },
  { pattern: /Android/i, label: 'Android' },
  { pattern: /Macintosh|Mac OS X/i, label: 'Mac' },
  { pattern: /Windows/i, label: 'Windows' },
  { pattern: /CrOS/i, label: 'Chromebook' },
  { pattern: /Linux/i, label: 'Linux' },
] as const satisfies ReadonlyArray<{ pattern: RegExp; label: string }>;

/** Remembers, per browser, that the resident chose to use the panel without notifications. */
export const NOTIFICATION_SKIP_STORAGE_KEY = 'ringgg:notifications-skipped';
