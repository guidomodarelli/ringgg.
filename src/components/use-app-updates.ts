'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AppVersion } from '@/types/app';

/**
 * Moves an open app onto a new deployment. An installed PWA can stay in memory for days, and the
 * panel never navigates, so it would keep running the old code until it is closed for good. The
 * version is read when the app opens and again every time it comes back to the foreground; a
 * different one reloads the page, though never while `busy` (an action is running): it waits for it.
 */
export function useAppUpdates(busy: boolean) {
  const [outdated, setOutdated] = useState(false);
  useEffect(() => {
    let loadedVersion: string | null = null;
    let stopped = false;
    async function check() {
      if (document.visibilityState !== 'visible') return;
      try {
        const { version } = await api<AppVersion>('version');
        if (stopped || !version) return;
        if (loadedVersion === null) loadedVersion = version;
        else if (version !== loadedVersion) setOutdated(true);
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
  }, []);
  useEffect(() => {
    if (outdated && !busy) window.location.reload();
  }, [outdated, busy]);
}
