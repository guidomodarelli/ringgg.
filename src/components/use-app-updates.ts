'use client';
import { useEffect, useState } from 'react';
import { APP_UPDATES } from '@/constants/app-updates';
import { api, onMutationsSettled, pendingMutations } from '@/lib/api';
import type { AppVersion } from '@/types/app';

interface AppUpdatesOptions {
  /** An action of the panel is running: the reload waits for it. */
  busy: boolean;
  /** The build of the code running in this page. Empty (no build to compare with) turns the check off. */
  loadedVersion: string;
}

/**
 * Moves an open app onto a new deployment. An installed PWA can stay in memory for days, and the
 * panel never navigates, so it would keep running the old code until it is closed for good. Each
 * time the app is in the foreground (when it opens and every time it comes back) the deployed
 * version is compared with the one this page loaded; a different one reloads the page. Never in the
 * middle of something: it waits while `busy`, and for every request that changes data to end
 * (whichever component sent it), plus a moment for what follows its answer.
 */
export function useAppUpdates({ busy, loadedVersion }: AppUpdatesOptions) {
  const [outdated, setOutdated] = useState(false);
  useEffect(() => {
    if (!loadedVersion) return;
    let stopped = false;
    async function check() {
      if (document.visibilityState !== 'visible') return;
      try {
        const { version } = await api<AppVersion>('version');
        if (!stopped && version && version !== loadedVersion) setOutdated(true);
      } catch {
        // Offline or a failed read: the next return to the app checks again.
      }
    }
    const checkNow = () => { void check(); };
    checkNow();
    document.addEventListener('visibilitychange', checkNow);
    // A page restored from the back/forward cache comes back without a visibility change.
    window.addEventListener('pageshow', checkNow);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', checkNow);
      window.removeEventListener('pageshow', checkNow);
    };
  }, [loadedVersion]);
  useEffect(() => {
    if (!outdated || busy) return;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    // Runs now and whenever the last running change ends; a change that starts during the wait postpones it again.
    const reloadOnceSettled = () => {
      clearTimeout(reloadTimer);
      if (pendingMutations() > 0) return;
      reloadTimer = setTimeout(() => { if (pendingMutations() === 0) window.location.reload(); }, APP_UPDATES.settleBeforeReloadMs);
    };
    const stopListening = onMutationsSettled(reloadOnceSettled);
    reloadOnceSettled();
    return () => {
      stopListening();
      clearTimeout(reloadTimer);
    };
  }, [outdated, busy]);
}
