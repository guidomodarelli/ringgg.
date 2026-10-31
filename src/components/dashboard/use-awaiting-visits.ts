'use client';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * How many visits of a home still wait for an answer, as the open panel last counted them. The sidebar is
 * rendered on the server, outside the panel that polls the visits, so its navigation reads them here.
 */
let published: { homeId: number; count: number } | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

/** The server and the hydration render have no clock, so nothing waits yet; the panel publishes once it reads it. */
function serverCount() {
  return 0;
}

/**
 * Publishes the panel's count for its home while it is mounted. A panel that unmounts (another home opened)
 * withdraws it, so the next home's navigation never shows the previous one's count.
 */
export function usePublishAwaitingVisits(homeId: number, count: number) {
  useEffect(() => {
    if (published?.homeId === homeId && published.count === count) return;
    published = { homeId, count };
    notify();
  }, [homeId, count]);
  useEffect(() => () => {
    if (published?.homeId !== homeId) return;
    published = null;
    notify();
  }, [homeId]);
}

/** Visits of `homeId` that still wait for an answer; `0` until the panel of that home publishes them. */
export function useAwaitingVisitCount(homeId: number) {
  const read = useCallback(() => published?.homeId === homeId ? published.count : 0, [homeId]);
  return useSyncExternalStore(subscribe, read, serverCount);
}
