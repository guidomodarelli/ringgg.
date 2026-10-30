'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { NOTIFICATION_SKIP_STORAGE_KEY } from '@/constants/devices';
import { api } from '@/lib/api';
import { suggestedDeviceName } from '@/lib/device-name';
import { needsNotificationSetup } from '@/lib/notification-setup';

type Permission = NotificationPermission | 'unsupported' | '';

function pushSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

function currentPermission(): Permission {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

/** Storage can be unavailable (private mode, blocked site data): then the choice lasts for this visit only. */
function readSkipped() {
  try { return window.localStorage.getItem(NOTIFICATION_SKIP_STORAGE_KEY) === '1'; } catch { return false; }
}

function writeSkipped(skipped: boolean) {
  try {
    if (skipped) window.localStorage.setItem(NOTIFICATION_SKIP_STORAGE_KEY, '1');
    else window.localStorage.removeItem(NOTIFICATION_SKIP_STORAGE_KEY);
  } catch { /* The choice still applies until the page reloads. */ }
}

/** Listeners of the two browser stores below, which change when the resident acts on this page. */
const skippedListeners = new Set<() => void>();
const permissionListeners = new Set<() => void>();

function notify(listeners: Set<() => void>) {
  for (const listener of listeners) listener();
}

/** The choice to use the panel without notifications: storage, plus memory for when storage fails. */
let skippedChoice: boolean | undefined;

function readSkippedChoice() {
  skippedChoice ??= readSkipped();
  return skippedChoice;
}

function saveSkippedChoice(skipped: boolean) {
  writeSkipped(skipped);
  skippedChoice = skipped;
  notify(skippedListeners);
}

function subscribeToSkipped(onChange: () => void) {
  skippedListeners.add(onChange);
  return () => { skippedListeners.delete(onChange); };
}

/** The permission can also change in the browser or system settings: it is read again when the page comes back. */
function subscribeToPermission(onChange: () => void) {
  permissionListeners.add(onChange);
  window.addEventListener('focus', onChange);
  document.addEventListener('visibilitychange', onChange);
  return () => {
    permissionListeners.delete(onChange);
    window.removeEventListener('focus', onChange);
    document.removeEventListener('visibilitychange', onChange);
  };
}

/** The server and the hydration render know neither the permission nor the stored choice. */
function serverPermission(): Permission {
  return '';
}

function serverSkipped() {
  return false;
}

/**
 * Notifications on this browser: which device the server registered it as for the resident in this
 * home, the first-entry prompt, the choice to keep using the panel without notifications, and
 * activation. The device can be disconnected later, here or by another resident, so whether it still
 * rings is read from the home's confirmed snapshot (see `useDashboardState`), not from this id.
 */
export function usePushDevice({ homeId, pushReady, viewerName }: { homeId: number; pushReady: boolean; viewerName: string }) {
  const permission = useSyncExternalStore(subscribeToPermission, currentPermission, serverPermission);
  const skipped = useSyncExternalStore(subscribeToSkipped, readSkippedChoice, serverSkipped);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const skippedBefore = readSkippedChoice();
    async function checkRegistration() {
      const supported = pushSupported();
      const browserPermission = currentPermission();
      if (!supported || browserPermission !== 'granted') {
        if (!cancelled) setShowSetup(!skippedBefore);
        return;
      }
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        const subscription = await registration.pushManager.getSubscription();
        const status = subscription ? await api<{ active: boolean; deviceId: string | null }>('device-status', { home: homeId, endpoint: subscription.endpoint }, controller.signal) : { active: false, deviceId: null };
        if (cancelled) return;
        setDeviceId(status.deviceId);
        setShowSetup(!skippedBefore && needsNotificationSetup(supported, browserPermission, Boolean(subscription), status.active));
      } catch {
        if (!cancelled) setShowSetup(!skippedBefore);
      }
    }
    void checkRegistration();
    return () => { cancelled = true; controller.abort(); };
  }, [homeId]);

  /** Server-confirmed: the device counts as connected only after the server stored the subscription. */
  async function activate() {
    if (!pushSupported()) throw new Error('En iPhone, agregá Ringgg a Inicio y abrila desde su ícono. Usá un navegador compatible con notificaciones.');
    if (!pushReady) throw new Error('Falta configurar las claves de notificaciones en el servidor. Consultá la guía del proyecto.');
    // Permission is requested before the first await to preserve the user gesture on iOS.
    const granted = await Notification.requestPermission();
    notify(permissionListeners);
    if (granted !== 'granted') throw new Error('No se habilitaron las notificaciones. Podés volver a intentarlo desde los ajustes del dispositivo.');
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const { publicKey } = await api<{ publicKey: string }>('push-key');
    // One subscription per browser: activating another home reuses it. The server keeps the name a
    // device already has in this home and only uses the suggestion for a new one.
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
    const saved = await api<{ deviceId: string }>('subscribe', { home: homeId, name: suggestedDeviceName(navigator.userAgent, viewerName), subscription: subscription.toJSON() });
    setDeviceId(saved.deviceId);
    setShowSetup(false);
    saveSkippedChoice(false);
  }

  /** Keeps using the panel on this browser without notifications; Devices offers to activate them later. */
  function skip() {
    saveSkippedChoice(true);
    setShowSetup(false);
  }

  function refreshPermission() {
    notify(permissionListeners);
  }

  return { permission, deviceId, showSetup, skipped, activate, skip, refreshPermission };
}
