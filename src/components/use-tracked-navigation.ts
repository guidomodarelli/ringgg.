'use client';
import { useCallback, useEffect, useRef, useTransition } from 'react';
import { holdNavigation } from '@/lib/pending-navigations';

/**
 * Runs a navigation inside a transition and counts it in `pendingNavigations()` until it ends. Next
 * resolves a router push, replace or refresh inside the caller's transition, so `isPending` lasts
 * until the next page rendered, however long its data takes. The navigation is counted from the
 * call itself, before React renders the pending state, so nothing can slip in between.
 *
 * A call that arrives once the component unmounted (an answer that came back after the resident
 * left that screen) still navigates, but is not counted: nothing would ever release that count, and
 * it would hold back every later app update until a manual reload.
 */
export function useTrackedNavigation() {
  const [navigating, startNavigation] = useTransition();
  const releases = useRef<Array<() => void>>([]);
  const mounted = useRef(false);
  useEffect(() => {
    if (navigating) return;
    for (const release of releases.current.splice(0)) release();
  }, [navigating]);
  // A navigation that unmounts this component (it opened another screen) stops counting with it.
  useEffect(() => {
    mounted.current = true;
    // The same array lives as long as the component: it is emptied in place, never replaced.
    const pendingReleases = releases.current;
    return () => {
      mounted.current = false;
      for (const release of pendingReleases.splice(0)) release();
    };
  }, []);
  return useCallback((navigate: () => void | Promise<void>) => {
    if (mounted.current) releases.current.push(holdNavigation());
    startNavigation(navigate);
  }, []);
}
