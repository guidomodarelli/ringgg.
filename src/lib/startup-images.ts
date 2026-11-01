import { STARTUP_SCREENS, type StartupScreen } from '@/constants/startup-images';

/** The launch image fills the screen in pixels: `<width>x<height>`. */
export function startupImageSize(screen: StartupScreen) {
  return `${screen.width * screen.ratio}x${screen.height * screen.ratio}`;
}

/** Portrait only: the app does not lock the orientation, but it is opened from the home screen held upright. */
export function startupImageMedia(screen: StartupScreen) {
  return `(device-width: ${screen.width}px) and (device-height: ${screen.height}px) and (-webkit-device-pixel-ratio: ${screen.ratio}) and (orientation: portrait)`;
}

/** Path of the launch image for a screen size, as `startupImageSize` writes it. */
export function startupImagePath(size: string) {
  return `/startup/${size}`;
}

/** Every launch image with the screen it belongs to, for `appleWebApp.startupImage`. */
export function startupImages(): Array<{ url: string; media: string }> {
  return STARTUP_SCREENS.map((screen) => ({ url: startupImagePath(startupImageSize(screen)), media: startupImageMedia(screen) }));
}
