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
