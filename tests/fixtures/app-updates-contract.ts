/**
 * Where the app-updates fixture counts the reloads its page started. Session storage outlives the
 * reload, and the count is written the moment the reload starts, before its request leaves the page.
 */
export const RELOADS_STARTED_STORAGE_KEY = 'app-updates:reloads-started';
