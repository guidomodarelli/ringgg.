'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, House, LoaderCircle, LogOut, ShieldCheck, Smartphone, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { ResidentManagement } from './resident-management';
import { NotificationOnboarding } from './notification-onboarding';
import { DoorOverview } from './dashboard/door-overview';
import { VisitHistory } from './dashboard/visit-history';
import { QrPanel } from './dashboard/qr-panel';
import { DevicesSection } from './dashboard/devices-section';
import { SettingsSection } from './dashboard/settings-section';
import type { DashboardData, DashboardSnapshot } from '@/types/doorbell';
import { DOORBELL } from '@/constants/doorbell';
import { api } from '@/lib/api';
import { needsNotificationSetup } from '@/lib/notification-setup';
import { DASHBOARD_VIEW_EVENT, type DashboardView } from '@/constants/dashboard-views';
import { getDashboardView } from '@/lib/dashboard-view';
import { visitFromUrl } from '@/lib/visit-format';

const SECTION_TITLES: Record<DashboardView, { title: string; detail: string }> = {
  overview: { title: 'Tu casa te llama', detail: 'Todo lo que pasa en tu puerta, estés donde estés.' },
  history: { title: 'Timbrazos', detail: 'Las visitas recientes de tu casa.' },
  qr: { title: 'Tu código QR', detail: 'Compartí el acceso al timbre de tu casa.' },
  devices: { title: 'Dispositivos', detail: 'Los celulares que reciben tu timbre.' },
  residents: { title: 'Residentes', detail: 'Las personas que comparten esta vivienda.' },
  settings: { title: 'Configuración', detail: 'Elegí cómo funciona el timbre de tu casa.' },
};

function statusLabel(home: DashboardSnapshot['home']) {
  if (!home.enabled) return 'Timbre en pausa';
  return home.quiet ? 'Horario de descanso' : 'Timbre activo';
}

export function Dashboard({ initial, initialView = 'overview' }: { initial: DashboardData; initialView?: DashboardView }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [pending, setPending] = useState('');
  const actionLock = useRef(false);
  const refreshGeneration = useRef(0);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState<number | null>(null);
  const [notificationState, setNotificationState] = useState('');
  const [showNotificationSetup, setShowNotificationSetup] = useState(false);
  const [view, setView] = useState<DashboardView>(initialView);
  const [focusVisitId, setFocusVisitId] = useState(initial.focusVisitId ?? '');
  const url = `${data.origin}/t/${data.home.token}`;

  useEffect(() => {
    const update = () => {
      const selected = getDashboardView(window.location.search, window.location.hash);
      setView(selected === 'residents' && !initial.isAdmin ? 'overview' : selected);
      setFocusVisitId(visitFromUrl(window.location.href));
    };
    update(); window.addEventListener('popstate', update); window.addEventListener(DASHBOARD_VIEW_EVENT, update);
    return () => { window.removeEventListener('popstate', update); window.removeEventListener(DASHBOARD_VIEW_EVENT, update); };
  }, []);

  // Polls every few seconds and refreshes immediately when a push arrives, the tab regains focus
  // or a notification opens a visit. Refreshes never overlap and never overwrite a running action.
  useEffect(() => {
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    let running = false;
    async function refresh() {
      if (running || stopped) return;
      running = true; clearTimeout(timer);
      setNow(Date.now());
      if (document.visibilityState === 'visible' && !actionLock.current) {
        const generation = refreshGeneration.current;
        controller = new AbortController();
        try { const fresh = await api<DashboardSnapshot>('dashboard', undefined, controller.signal); if (!stopped && !actionLock.current && generation === refreshGeneration.current) setData((previous) => ({ ...previous, ...fresh })); }
        catch (error) { if (!controller.signal.aborted && !stopped) setError(error instanceof Error ? error.message : 'No pudimos actualizar.'); }
      }
      running = false;
      if (!stopped) timer = setTimeout(refresh, DOORBELL.pollIntervalMs);
    }
    const refreshNow = () => { if (document.visibilityState === 'visible') void refresh(); };
    const onWorkerMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; url?: unknown } | null;
      if (message?.type === 'ringgg:open' && typeof message.url === 'string' && message.url.startsWith('/')) {
        window.history.pushState(null, '', message.url);
        window.dispatchEvent(new Event(DASHBOARD_VIEW_EVENT));
      }
      if (message?.type === 'ringgg:push' || message?.type === 'ringgg:open') refreshNow();
    };
    setNow(Date.now()); timer = setTimeout(refresh, DOORBELL.pollIntervalMs);
    setNotificationState('Notification' in window ? Notification.permission : 'unsupported');
    document.addEventListener('visibilitychange', refreshNow);
    window.addEventListener('focus', refreshNow);
    navigator.serviceWorker?.addEventListener('message', onWorkerMessage);
    return () => {
      stopped = true; clearTimeout(timer); controller?.abort();
      document.removeEventListener('visibilitychange', refreshNow);
      window.removeEventListener('focus', refreshNow);
      navigator.serviceWorker?.removeEventListener('message', onWorkerMessage);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function checkNotifications() {
      const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
      const permission = 'Notification' in window ? Notification.permission : 'unsupported';
      if (!supported || permission !== 'granted') {
        if (!cancelled) setShowNotificationSetup(true);
        return;
      }
      try {
        const registration = supported ? await navigator.serviceWorker.register('/sw.js') : null;
        const subscription = registration ? await registration.pushManager.getSubscription() : null;
        const registered = subscription ? await api<{ active: boolean }>('device-status', { endpoint: subscription.endpoint }, controller.signal) : { active: false };
        if (!cancelled) setShowNotificationSetup(needsNotificationSetup(supported, permission, Boolean(subscription), registered.active));
      } catch {
        if (!cancelled) setShowNotificationSetup(true);
      }
    }
    void checkNotifications();
    return () => { cancelled = true; controller.abort(); };
  }, []);

  async function action(key: string, work: () => Promise<unknown>, success: string | ((result: unknown) => string)) {
    if (actionLock.current) return false;
    actionLock.current = true; refreshGeneration.current += 1; setPending(key); setError(''); setFeedback('');
    try {
      const result = await work();
      const fresh = await api<DashboardSnapshot>('dashboard');
      setData((previous) => ({ ...previous, ...fresh })); setFeedback(typeof success === 'function' ? success(result) : success);
      if (key === 'name') router.refresh();
      return true;
    } catch (error) { setError(error instanceof Error ? error.message : 'No pudimos completar la acción. Reintentá.'); return false; }
    finally { setPending(''); actionLock.current = false; }
  }

  async function signOut() {
    const result = await authClient.signOut();
    if (result.error) throw new Error('No pudimos cerrar tu sesión. Reintentá.');
    window.location.assign('/');
  }

  async function subscribe() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('En iPhone, agregá Ringgg a Inicio y abrila desde su ícono. Usá un navegador compatible con notificaciones.');
    if (!data.pushReady) throw new Error('Falta configurar las claves de notificaciones en el servidor. Consultá la guía del proyecto.');
    // Permission is requested before the first await to preserve the user gesture on iOS.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { setNotificationState(permission); throw new Error('No se habilitaron las notificaciones. Podés volver a intentarlo desde los ajustes del dispositivo.'); }
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const { publicKey } = await api<{ publicKey: string }>('push-key');
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
    await api('subscribe', { name: 'Mi celular', subscription: subscription.toJSON() });
    setNotificationState(Notification.permission);
  }

  return <>
    <header className="topbar"><span><House size={15} /> Mi espacio <span className="slash">/</span> <strong>{data.home.name}</strong></span><button className="text-button" disabled={!!pending} onClick={() => action('logout', signOut, '')}><LogOut size={16} /> Salir</button></header>
    <main className="dashboard-main" id="main" data-view={view}>
      <div className="page-heading"><div><span className="eyebrow">UN POCO MÁS CERCA</span><h1>{SECTION_TITLES[view].title}<span>.</span></h1><p>{SECTION_TITLES[view].detail}</p></div><span className={`status-pill ${data.home.enabled && !data.home.quiet ? 'active' : ''}`}><i />{statusLabel(data.home)}</span></div>
      {showNotificationSetup && <NotificationOnboarding permission={notificationState} pending={!!pending} error={error} onRefresh={() => { setError(''); setNotificationState('Notification' in window ? Notification.permission : 'unsupported'); }} onSignOut={() => { void action('logout', signOut, ''); }} onActivate={() => { void action('subscribe', subscribe, 'Dispositivo conectado. Enviá una prueba para comprobarlo.').then((success) => { if (success) setShowNotificationSetup(false); }); }} />}
      <div className="feedback-wrap" aria-live="polite">{feedback && <p className="feedback success"><Check size={17} />{feedback}<button aria-label="Cerrar aviso" onClick={() => setFeedback('')}><X size={16} /></button></p>}{error && <p className="feedback error" role="alert">{error}<button aria-label="Cerrar error" onClick={() => setError('')}><X size={16} /></button></p>}</div>
      <div className="dashboard-grid"><div className="primary-column">
        <DoorOverview url={url} data={data} />
        <VisitHistory visits={data.visits} now={now} url={url} pending={pending} run={action} focusVisitId={focusVisitId} />
      </div><aside className="context-column">
        <QrPanel url={url} homeName={data.home.name} pending={pending} run={action} onFeedback={setFeedback} onError={setError} />
        <section className="setup-callout"><span className="soft-icon"><Smartphone size={21} /></span><h3>Tu timbre va con vos</h3><p>Activá las notificaciones en este celular para enterarte cuando alguien llega.</p><a className="text-link" href="/?view=devices">Configurar mi celular <ArrowUpRight size={16} /></a></section>
        <div className="privacy-note"><ShieldCheck size={18} /><p>Tu casa, tu privacidad.<br /><span>Tu QR no comparte tus datos.</span></p></div>
      </aside></div>
      <DevicesSection devices={data.devices} pending={pending} run={action} />
      <SettingsSection home={data.home} pending={pending} run={action} />
      {data.isAdmin && <ResidentManagement initial={initial.residents} />}
      <footer className="dashboard-footer"><span>ringgg. <span>Una forma más simple de llegar.</span></span><span>Hecho para estar cerca <span className="orange">✳</span></span></footer>
      {pending && <span className="operation-status" role="status"><LoaderCircle className="spin" size={15} /> Procesando…</span>}
    </main>
  </>;
}
