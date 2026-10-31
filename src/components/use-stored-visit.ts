'use client';
import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';
import { HTTP } from '@/constants/doorbell';
import { api, ApiError } from '@/lib/api';
import { forgetStoredVisit, storedVisitEnd, storedVisitSnapshot, subscribeToStoredVisits, type StoredVisit } from '@/lib/visit-storage';
import type { PublicVisit } from '@/types/doorbell';

/** `reading` until this browser's storage was read (the server render cannot), `checking` while a stored ring is read back. */
export type StoredVisitPhase = 'reading' | 'checking' | 'ready';

/** The server render, and the hydration that has to match it, know nothing about this browser. */
function unreadOnServer() {
  return undefined;
}

interface StoredVisitOptions {
  token: string;
  /** The visit on screen, if any. */
  visit: PublicVisit | null;
  /** The server returned the stored ring, still inside its window: show it and keep its operation id. */
  onRestore: (visit: PublicVisit, stored: StoredVisit) => void;
  /** The stored ring could not be read back (offline, server error): keep its operation id so a new tap cannot ring twice. */
  onUnreadable: (stored: StoredVisit) => void;
  /** The window of the visit on screen closed while the page was open. */
  onExpire: () => void;
}

/**
 * Brings back the ring this browser made at this door when the page reloads or the QR is scanned again (a new tab),
 * so the visitor keeps waiting for the same answer instead of ringing twice. Storage is read after hydration.
 */
export function useStoredVisit({ token, visit, onRestore, onUnreadable, onExpire }: StoredVisitOptions): StoredVisitPhase {
  const stored = useSyncExternalStore(subscribeToStoredVisits, () => storedVisitSnapshot(token), unreadOnServer);
  // The stored ring already read back, or that failed to: it is never read twice.
  const [settledId, setSettledId] = useState<string | null>(null);
  const pending = stored && stored.visitId !== visit?.id && stored.visitId !== settledId ? stored : null;
  const restore = useEffectEvent(onRestore);
  const keepOperation = useEffectEvent(onUnreadable);
  const expire = useEffectEvent(onExpire);

  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    async function readBack(entry: StoredVisit) {
      try {
        const fresh = await api<PublicVisit>(`door/${token}/visits/${entry.visitId}`, undefined, controller.signal);
        // The server's time of the ring decides: the stored one only spared a request for an old ring.
        if (Date.now() < storedVisitEnd(fresh.created_at)) restore(fresh, entry);
        else forgetStoredVisit(token);
      } catch (error) {
        if (controller.signal.aborted) return;
        // Gone from this door: nothing to show. Any other failure may pass, so the reference stays.
        if (error instanceof ApiError && error.status === HTTP.notFound) forgetStoredVisit(token);
        else keepOperation(entry);
      }
      setSettledId(entry.visitId);
    }
    void readBack(pending);
    return () => { controller.abort(); };
  }, [token, pending]);

  const createdAt = visit?.created_at;
  useEffect(() => {
    if (!createdAt) return;
    const timer = setTimeout(() => { expire(); }, storedVisitEnd(createdAt) - Date.now());
    return () => { clearTimeout(timer); };
  }, [createdAt]);

  if (stored === undefined) return 'reading';
  return pending ? 'checking' : 'ready';
}
