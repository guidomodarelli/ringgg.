/** `navigator.standalone` only exists in WebKit on iOS and iPadOS: `true` inside an app added from Safari. */
type ShareCapableNavigator = { standalone?: boolean; canShare?: (data?: ShareData) => boolean; share?: (data?: ShareData) => Promise<void> };

/**
 * Whether the app runs installed from Safari on iPhone or iPad. WebKit's standalone mode ignores
 * `<a download>` and `window.print()`: a tap on them does nothing, so files go through the share sheet.
 */
export function isInstalledAppleApp(nav: ShareCapableNavigator) {
  return nav.standalone === true;
}

/**
 * Whether a file has to go through the share sheet to be saved or printed. Only the installed app on
 * iPhone or iPad needs it; its share sheet offers «Guardar imagen», «Guardar en Archivos» and «Imprimir».
 * Everywhere else the page downloads or prints as usual.
 */
export function needsShareToSave(nav: ShareCapableNavigator, file: File) {
  if (!isInstalledAppleApp(nav)) return false;
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try { return nav.canShare({ files: [file] }); }
  catch { return false; }
}

/** A share the resident closed without choosing anything: not an error. */
export function isShareCancelled(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}
