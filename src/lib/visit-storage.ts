import { DOORBELL, VISIT_STORAGE_KEY_PREFIX } from '@/constants/doorbell';
import { TIME } from '@/constants/time';

/**
 * A ring this browser made at one door. `operationId` is what retrying the ring sends and `visitId` what the page
 * reads back; the server files each visit under its ring's operation id, so today both hold the same value.
 * `createdAt` is the server's time of the ring.
 */
export interface StoredVisit { visitId: string; operationId: string; createdAt: string }

function storageKey(token: string) {
  return `${VISIT_STORAGE_KEY_PREFIX}${token}`;
}

/** When a ring stops being worth showing again: the end of its note window, the last thing that can happen to it. */
export function storedVisitEnd(createdAt: string) {
  return new Date(createdAt).getTime() + DOORBELL.noteWindowSeconds * TIME.secondMs;
}

function parseStoredVisit(raw: string): StoredVisit | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (typeof value !== 'object' || value === null) return null;
  const { visitId, operationId, createdAt } = value as Record<string, unknown>;
  return typeof visitId === 'string' && typeof operationId === 'string' && typeof createdAt === 'string' ? { visitId, operationId, createdAt } : null;
}

/** Storage can be unavailable (private mode, blocked site data): that reads as no ring, and the page works as before. */
function readStorage(token: string): StoredVisit | null {
  try {
    const raw = localStorage.getItem(storageKey(token));
    if (raw === null) return null;
    const stored = parseStoredVisit(raw);
    if (stored && Date.now() < storedVisitEnd(stored.createdAt)) return stored;
    // Unreadable, or its window closed: there is nothing left to show for it.
    localStorage.removeItem(storageKey(token));
  } catch { /* Nothing stored can be read. */ }
  return null;
}

/** Each door's stored ring as this page last read or wrote it, so every render agrees on it. */
const snapshots = new Map<string, StoredVisit | null>();
const listeners = new Set<() => void>();

/** Subscribes to the rings this page saves or forgets. */
export function subscribeToStoredVisits(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** This door's stored ring, read from the browser the first time it is asked for. */
export function storedVisitSnapshot(token: string) {
  if (!snapshots.has(token)) snapshots.set(token, readStorage(token));
  return snapshots.get(token) ?? null;
}

function publish(token: string, visit: StoredVisit | null) {
  snapshots.set(token, visit);
  for (const listener of listeners) listener();
}

/** Remembers a ring the server registered. Without storage the ring still works; it just cannot come back after a reload. */
export function saveStoredVisit(token: string, visit: StoredVisit) {
  try { localStorage.setItem(storageKey(token), JSON.stringify(visit)); } catch { /* Kept for this page only. */ }
  publish(token, visit);
}

/** Forgets this door's ring: the visitor rings again or its window closed. */
export function forgetStoredVisit(token: string) {
  try { localStorage.removeItem(storageKey(token)); } catch { /* Nothing could be stored either. */ }
  publish(token, null);
}
