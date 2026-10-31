'use client';
import { useEffect, useRef, useState } from 'react';
import { api, pendingMutations } from '@/lib/api';
import { pendingNavigations } from '@/lib/pending-navigations';
import { reloadFollowingTaps } from '@/lib/reload-following-taps';
import type { AppVersion } from '@/types/app';

interface AppUpdatesOptions {
  /** An action of the panel is running: a return to the app while it runs leaves the update for the next one. */
  busy: boolean;
  /** The build of the code running in this page. Empty (no build to compare with) turns the check off. */
  loadedVersion: string;
}

/**
 * Moves an open app onto a new deployment. An installed PWA can stay in memory for days, and the
 * panel never navigates, so it would keep running the old code until it is closed for good. Each
 * time the app comes to the foreground (when it opens and every time it comes back) the deployed
 * version is compared with the one this page loaded, and a different one reloads the page right
 * then, only if nothing is running at that moment: no action of the panel (`busy`), no request that
 * changes data (whichever component sent it), no navigation of the panel still loading its next page
 * (`useTrackedNavigation`) and no address change while the version was read.
 * Otherwise nothing is scheduled: the next return to the app checks again. So a reload never cuts
 * an action short, nor what follows its answer (a confirmation, or opening a just-created home),
 * however long that takes.
 *
 * Returns `true` while that reload loads the new version. The page stays on screen until then, so
 * it says so, and a tap meanwhile is not lost: a link opens its address on the new version, and
 * anything else waits for it (`reloadFollowingTaps`).
 */
export function useAppUpdates({ busy, loadedVersion }: AppUpdatesOptions): boolean {
  const [updating, setUpdating] = useState(false);
  const busyRef = useRef(busy);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => {
    if (!loadedVersion) return;
    let stopped = false;
    let stopFollowingTaps: (() => void) | null = null;
    async function reloadIfOutdated() {
      if (document.visibilityState !== 'visible') return;
      const addressBeforeRead = window.location.href;
      let deployedVersion: string;
      try {
        ({ version: deployedVersion } = await api<AppVersion>('version'));
      } catch {
        // Offline or a failed read: the next return to the app checks again.
        return;
      }
      if (stopped || stopFollowingTaps || !deployedVersion || deployedVersion === loadedVersion) return;
      const somethingRunning = busyRef.current || pendingMutations() > 0 || pendingNavigations() > 0 || window.location.href !== addressBeforeRead;
      if (somethingRunning) return;
      setUpdating(true);
      // A reload the browser stopped leaves this page as it was; the next return to the app checks again.
      stopFollowingTaps = reloadFollowingTaps(() => { stopFollowingTaps = null; setUpdating(false); });
    }
    const checkNow = () => { void reloadIfOutdated(); };
    checkNow();
    document.addEventListener('visibilitychange', checkNow);
    // A page restored from the back/forward cache comes back without a visibility change.
    window.addEventListener('pageshow', checkNow);
    return () => {
      stopped = true;
      stopFollowingTaps?.();
      document.removeEventListener('visibilitychange', checkNow);
      window.removeEventListener('pageshow', checkNow);
    };
  }, [loadedVersion]);
  return updating;
}
