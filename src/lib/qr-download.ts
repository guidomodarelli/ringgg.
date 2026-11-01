/** Name the downloaded or shared QR image takes on the resident's device. */
export const QR_FILE_NAME = 'ringgg-mi-timbre.png';

/** Turns the QR's `data:` URL into a PNG file, synchronously, so it is ready before the tap. */
export function dataUrlToFile(dataUrl: string, name: string = QR_FILE_NAME) {
  const [header = '', payload = ''] = dataUrl.split(',', 2);
  const type = /^data:([^;,]+)/.exec(header)?.[1] ?? 'image/png';
  // `atob` returns one character per byte, all below 256.
  const bytes = Uint8Array.from(atob(payload), (byte) => byte.codePointAt(0) ?? 0);
  return new File([bytes], name, { type });
}

/** `navigator.standalone` only exists in WebKit on iOS and iPadOS: `true` inside an app added from Safari. */
type ShareCapableNavigator = { standalone?: boolean; canShare?: (data?: ShareData) => boolean; share?: (data?: ShareData) => Promise<void> };

/**
 * Whether the QR has to go through the share sheet instead of `<a download>`. An app installed from
 * Safari on iPhone or iPad runs in WebKit's standalone mode, which ignores `download`: the tap does
 * nothing. The share sheet there offers «Guardar imagen» and «Guardar en Archivos». Everywhere else
 * the link downloads the image as usual.
 */
export function needsShareToSave(nav: ShareCapableNavigator, file: File) {
  if (nav.standalone !== true) return false;
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try { return nav.canShare({ files: [file] }); }
  catch { return false; }
}

/** A share the resident closed without choosing anything: not an error. */
export function isShareCancelled(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}
