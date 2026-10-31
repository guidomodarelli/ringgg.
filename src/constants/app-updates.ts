/**
 * How long the page waits for its update reload to open the new version. If that reload never
 * commits (the browser stopped it), taps work on this page again instead of staying held.
 */
export const APP_UPDATES = { reloadGiveUpMs: 20_000 };
