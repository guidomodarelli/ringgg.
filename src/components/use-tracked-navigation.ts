'use client';
import { useCallback, useEffect, useRef, useTransition } from 'react';
import { holdNavigation } from '@/lib/pending-navigations';

/**
 * Runs a navigation inside a transition and counts it in `pendingNavigations()` until it ends. Next
 * resolves a router push, replace or refresh inside the caller's transition, so `isPending` lasts
 * until the next page rendered, however long its data takes. The navigation is counted from the
 * call itself, before React renders the pending state, so nothing can slip in between.
 */
export function useTrackedNavigation() {
  const [navigating, startNavigation] = useTransition();
  const releases = useRef<Array<() => void>>([]);
  useEffect(() => {
    if (navigating) return;
    for (const release of releases.current.splice(0)) release();
  }, [navigating]);
  // A navigation that unmounts this component (it opened another screen) stops counting with it.
  useEffect(() => () => { for (const release of releases.current.splice(0)) release(); }, []);
  return useCallback((navigate: () => void | Promise<void>) => {
    releases.current.push(holdNavigation());
    startNavigation(navigate);
  }, []);
}
