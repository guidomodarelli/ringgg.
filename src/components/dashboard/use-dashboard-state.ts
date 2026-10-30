'use client';
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { DOORBELL } from '@/constants/doorbell';
import { DASHBOARD_POLLING } from '@/constants/polling';
import { WORKER_MESSAGES } from '@/constants/push';
import { DASHBOARD_VIEW_EVENT } from '@/constants/dashboard-views';
import { TIME } from '@/constants/time';
import { HOMES } from '@/constants/homes';
import type { DashboardData, DashboardSnapshot, Visit } from '@/types/doorbell';
import { api } from '@/lib/api';
import type { Reconcile, RunAction } from './types';

/** Snapshot address of one home. */
export function dashboardPath(homeId: number) {
  return `dashboard?${HOMES.queryParameter}=${homeId}`;
}

/** Comparable form of the polled state; field order matches the `snapshot()` response. */
export function serializeSnapshot({ home, visits, devices }: DashboardSnapshot) {
  return JSON.stringify({ home, visits, devices });
}

/**
 * The clock must tick while the rendered clock still shows an answerable visit, so a tab resumed
 * after the window advances once and hides the reply buttons before ticks stop.
 */
export function awaitingAnswer(visits: Visit[], renderedNow: number | null) {
  return visits.some((visit) => !visit.answered_at && (renderedNow === null || renderedNow - new Date(visit.created_at).getTime() < DOORBELL.responseWindowSeconds * TIME.secondMs));
}

/**
 * Delay until the next check: fast while a visit can be answered (another resident may answer it),
 * otherwise slower. A browser that receives notifications is woken by the push itself, so its
 * checks are only a backup for a push that fails silently.
 */
export function pollDelay(visits: Visit[], now: number, pushActive: boolean) {
  if (awaitingAnswer(visits, now)) return DASHBOARD_POLLING.answeringMs;
  return pushActive ? DASHBOARD_POLLING.idleWithPushMs : DASHBOARD_POLLING.idleMs;
}

/** Clock of the answer window. It only moves when the refresh loop ticks it, so an idle dashboard never re-renders. */
interface AnswerClock {
  subscribe: (onTick: () => void) => () => void;
  /** Time of the last tick, in milliseconds; the first read starts the clock. */
  read: () => number;
  tick: () => void;
}

function createAnswerClock(): AnswerClock {
  let now: number | undefined;
  const listeners = new Set<() => void>();
  return {
    subscribe: (onTick) => { listeners.add(onTick); return () => { listeners.delete(onTick); }; },
    read: () => { now ??= Date.now(); return now; },
    tick: () => { now = Date.now(); for (const listener of listeners) listener(); },
  };
}

/** The server and the hydration render have no clock: reply buttons appear once the browser reads it. */
function serverClock() {
  return null;
}

interface PollingOptions {
  homeId: number;
  clock: AnswerClock;
  /** Set while an action runs: checks skip the request and keep the action's result. */
  actionLock: RefObject<boolean>;
  /** Bumped by every action, so a check that started before it is discarded. */
  refreshGeneration: RefObject<number>;
  lastSnapshot: RefObject<string>;
  visits: RefObject<Visit[]>;
  pushActive: RefObject<boolean>;
  onSnapshot: (fresh: DashboardSnapshot) => void;
  onSyncError: (message: string) => void;
  /** A notification of another home opens that home instead of changing this one's URL. */
  openOtherHome: (url: string) => void;
}

/**
 * Checks the dashboard until stopped. Checks never overlap and never overwrite a running action; an
 * unchanged snapshot does not re-render. A push or a click on a notification checks right away.
 */
function startPolling({ homeId, clock, actionLock, refreshGeneration, lastSnapshot, visits, pushActive, onSnapshot, onSyncError, openOtherHome }: PollingOptions) {
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running = false;
  function schedule() {
    if (!stopped) timer = setTimeout(() => { void refresh(); }, pollDelay(visits.current, Date.now(), pushActive.current));
  }
  function tickWhileAwaiting(current: Visit[]) {
    if (awaitingAnswer(current, clock.read())) clock.tick();
  }
  async function check() {
    const generation = refreshGeneration.current;
    const request = new AbortController();
    controller = request;
    try {
      const fresh = await api<DashboardSnapshot>(dashboardPath(homeId), undefined, request.signal);
      if (stopped) return;
      onSyncError('');
      const serialized = serializeSnapshot(fresh);
      if (actionLock.current || generation !== refreshGeneration.current || serialized === lastSnapshot.current) return;
      lastSnapshot.current = serialized;
      onSnapshot(fresh);
      tickWhileAwaiting(fresh.visits);
    } catch (refreshError) {
      if (!request.signal.aborted && !stopped) onSyncError(refreshError instanceof Error ? refreshError.message : 'No pudimos actualizar el panel.');
    }
  }
  async function refresh() {
    if (running || stopped) return;
    running = true; clearTimeout(timer);
    tickWhileAwaiting(visits.current);
    if (document.visibilityState === 'visible' && !actionLock.current) await check();
    running = false;
    schedule();
  }
  const refreshNow = () => { if (document.visibilityState === 'visible') void refresh(); };
  const onWorkerMessage = (event: MessageEvent) => {
    const message = event.data as { type?: string; url?: unknown } | null;
    if (message?.type === WORKER_MESSAGES.open && typeof message.url === 'string' && message.url.startsWith('/')) {
      const target = new URL(message.url, window.location.origin).searchParams.get(HOMES.queryParameter);
      if (target !== null && target !== String(homeId)) { openOtherHome(message.url); return; }
      window.history.pushState(null, '', message.url);
      window.dispatchEvent(new Event(DASHBOARD_VIEW_EVENT));
    }
    if (message?.type === WORKER_MESSAGES.push || message?.type === WORKER_MESSAGES.open) refreshNow();
  };
  schedule();
  document.addEventListener('visibilitychange', refreshNow);
  window.addEventListener('focus', refreshNow);
  navigator.serviceWorker?.addEventListener('message', onWorkerMessage);
  const stop = () => {
    stopped = true; clearTimeout(timer); controller?.abort();
    document.removeEventListener('visibilitychange', refreshNow);
    window.removeEventListener('focus', refreshNow);
    navigator.serviceWorker?.removeEventListener('message', onWorkerMessage);
  };
  return { refreshNow, stop };
}

/** The home an action belongs to and how its confirmed result updates local state. */
interface ReconcileTarget {
  homeId: number;
  applySnapshot: (snapshot: DashboardSnapshot) => void;
  replaceVisit: (visit: Visit) => void;
}

/** Applies a confirmed action to local state; see `Reconcile`. */
async function reconcileAction(reconcile: Reconcile, result: unknown, target: ReconcileTarget) {
  switch (reconcile) {
    case 'snapshot': target.applySnapshot(result as DashboardSnapshot); break;
    case 'visit': target.replaceVisit(result as Visit); break;
    case 'refetch': target.applySnapshot(await api<DashboardSnapshot>(dashboardPath(target.homeId))); break;
    case 'none': break;
  }
}

/** Actions that change what the server-rendered sidebar shows: the home name and the resident's own name. */
const SERVER_RENDERED_KEYS = new Set(['name', 'viewer-name']);

/**
 * Dashboard data, polling and server-confirmed actions. Refreshes never overlap and never overwrite a
 * running action; an unchanged snapshot does not re-render. A failed refresh shows a sync notice that
 * clears itself on the next successful one, separate from the error of an action.
 */
export function useDashboardState(initial: DashboardData, pushActive: boolean) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [pending, setPending] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  /** Key of the action whose error `error` holds, so a form can show its own error next to its field. */
  const [failedAction, setFailedAction] = useState('');
  const [syncError, setSyncError] = useState('');
  const [clock] = useState(createAnswerClock);
  const now = useSyncExternalStore<number | null>(clock.subscribe, clock.read, serverClock);
  const actionLock = useRef(false);
  const refreshGeneration = useRef(0);
  const lastSnapshot = useRef(serializeSnapshot(initial));
  const visitsRef = useRef(initial.visits);
  const pushActiveRef = useRef(pushActive);
  const refreshNowRef = useRef<() => void>(() => undefined);

  useEffect(() => { visitsRef.current = data.visits; }, [data.visits]);
  useEffect(() => { pushActiveRef.current = pushActive; }, [pushActive]);
  useEffect(() => {
    const polling = startPolling({
      homeId: initial.home.id,
      clock, actionLock, refreshGeneration, lastSnapshot, visits: visitsRef, pushActive: pushActiveRef,
      // The next check is scheduled right after this one, before React renders the new visits.
      onSnapshot: (fresh) => { visitsRef.current = fresh.visits; setData((previous) => ({ ...previous, ...fresh })); },
      onSyncError: setSyncError,
      openOtherHome: (url) => { router.push(url); },
    });
    refreshNowRef.current = polling.refreshNow;
    return polling.stop;
  }, [clock, initial.home.id, router]);

  function applySnapshot(snapshot: DashboardSnapshot) {
    lastSnapshot.current = serializeSnapshot(snapshot);
    setData((previous) => ({ ...previous, ...snapshot }));
  }
  function replaceVisit(visit: Visit) {
    setData((previous) => ({ ...previous, visits: previous.visits.map((item) => item.id === visit.id ? visit : item) }));
  }

  const run: RunAction = async (key, work, success, reconcile = 'refetch') => {
    if (actionLock.current) return false;
    actionLock.current = true; refreshGeneration.current += 1; setPending(key); setError(''); setFailedAction(''); setFeedback('');
    try {
      const result = await work();
      // Reconcile from the confirmed response when it already carries the new state.
      await reconcileAction(reconcile, result, { homeId: initial.home.id, applySnapshot, replaceVisit });
      setFeedback(typeof success === 'function' ? success(result) : success);
      // The sidebar is rendered on the server: names it shows come back with a refresh.
      if (SERVER_RENDERED_KEYS.has(key)) router.refresh();
      return true;
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : 'No pudimos completar la acción. Reintentá.'); setFailedAction(key); return false; }
    finally { setPending(''); actionLock.current = false; }
  };

  return { data, pending, feedback, setFeedback, error, setError, failedAction, syncError, now, run, retrySync: () => refreshNowRef.current() };
}
