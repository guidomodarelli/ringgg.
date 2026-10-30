'use client';
import { useCallback, useSyncExternalStore } from 'react';
import { DASHBOARD_PATH, DASHBOARD_VIEW_EVENT, type DashboardView } from '@/constants/dashboard-views';
import { getDashboardView } from '@/lib/dashboard-view';
import { visitFromUrl } from '@/lib/visit-format';

/** Back and forward, and in-place section switches (`navigateDashboard`), change the dashboard URL. */
function subscribeToDashboardUrl(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(DASHBOARD_VIEW_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(DASHBOARD_VIEW_EVENT, onChange);
  };
}

/**
 * A value of the dashboard URL. The server renders it from the request; that value also applies while
 * hydrating and while a client navigation renders the dashboard before the browser shows its URL (on
 * any other path, the URL still belongs to the page being left).
 */
function useDashboardUrlValue<Value>(read: (location: Location) => Value, serverValue: Value): Value {
  const getSnapshot = useCallback(() => window.location.pathname === DASHBOARD_PATH ? read(window.location) : serverValue, [read, serverValue]);
  return useSyncExternalStore(subscribeToDashboardUrl, getSnapshot, () => serverValue);
}

function readView(location: Location) {
  return getDashboardView(location.search, location.hash);
}

function readFocusVisitId(location: Location) {
  return visitFromUrl(location.href);
}

/** The visible section: `?view=`, or the `#section` of an older link. */
export function useDashboardView(initialView: DashboardView): DashboardView {
  return useDashboardUrlValue(readView, initialView);
}

/** The visit a notification opened (`?visit=`), or `''`. */
export function useFocusVisitId(initialFocusVisitId: string): string {
  return useDashboardUrlValue(readFocusVisitId, initialFocusVisitId);
}
