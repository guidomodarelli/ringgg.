/**
 * iPhone screens, in CSS points and pixel ratio, that get their own launch image. iOS shows an installed
 * app's `apple-touch-startup-image` only when its size matches the screen exactly; without one it shows a
 * blank screen (black in dark mode) until the first page paints.
 */
export const STARTUP_SCREENS = [
  { width: 440, height: 956, ratio: 3 }, // 16 Pro Max, 17 Pro Max
  { width: 420, height: 912, ratio: 3 }, // Air
  { width: 402, height: 874, ratio: 3 }, // 16 Pro, 17, 17 Pro
  { width: 430, height: 932, ratio: 3 }, // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  { width: 393, height: 852, ratio: 3 }, // 14 Pro, 15, 15 Pro, 16, 16e
  { width: 428, height: 926, ratio: 3 }, // 12 Pro Max, 13 Pro Max, 14 Plus
  { width: 390, height: 844, ratio: 3 }, // 12, 12 Pro, 13, 13 Pro, 14
  { width: 375, height: 812, ratio: 3 }, // X, XS, 11 Pro, 12 mini, 13 mini
  { width: 414, height: 896, ratio: 3 }, // XS Max, 11 Pro Max
  { width: 414, height: 896, ratio: 2 }, // XR, 11
  { width: 414, height: 736, ratio: 3 }, // 6 Plus to 8 Plus
  { width: 375, height: 667, ratio: 2 }, // 6 to 8, SE (2nd and 3rd generation)
  { width: 320, height: 568, ratio: 2 }, // SE (1st generation)
] as const;

export type StartupScreen = (typeof STARTUP_SCREENS)[number];

/** Share of the screen width the app icon takes in the launch image. */
export const STARTUP_ICON_WIDTH_SHARE = 0.3;
