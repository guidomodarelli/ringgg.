'use client';
import { useEffect, useState, useRef } from 'react';
import { ArrowDownToLine, ArrowUpRight, Bell, BellRing, Check, CheckCheck, Copy, ExternalLink, House, Laptop, LoaderCircle, LogOut, Pause, Play, QrCode, RefreshCw, Settings2, ShieldCheck, Smartphone, Trash2, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { ResidentManagement } from './resident-management';
import { NotificationOnboarding } from './notification-onboarding';
import { DoorbellPauseControl } from './doorbell-pause-control';
import type { DashboardData } from '@/types/doorbell';
import { DOORBELL } from '@/constants/doorbell';
import { api } from '@/lib/api';
import { needsNotificationSetup } from '@/lib/notification-setup';
import { DASHBOARD_VIEW_EVENT, type DashboardView } from '@/constants/dashboard-views';
import { getDashboardView } from '@/lib/dashboard-view';

function visitTime(value: string) { return new Intl.DateTimeFormat('es-AR', { timeZone: DOORBELL.timeZone, hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }).format(new Date(value)); }

export function Dashboard({ initial, initialView = 'overview' }: { initial: DashboardData; initialView?: DashboardView }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [pending, setPending] = useState('');
  const actionLock = useRef(false);
  const refreshGeneration = useRef(0);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [name, setName] = useState(initial.home.name);
  const [qr, setQr] = useState('');
  const [confirmRotation, setConfirmRotation] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState('');
  const [now, setNow] = useState<number | null>(null);
  const [notificationState, setNotificationState] = useState('');
  const [showNotificationSetup, setShowNotificationSetup] = useState(false);
  const [view, setView] = useState<DashboardView>(initialView);
  const url = `${data.origin}/t/${data.home.token}`;
  const sectionTitles: Record<DashboardView, { title: string; detail: string }> = {
    overview: { title: 'Tu casa te llama', detail: 'Todo lo que pasa en tu puerta, estés donde estés.' },
    history: { title: 'Timbrazos', detail: 'Las visitas recientes de tu casa.' },
    qr: { title: 'Tu código QR', detail: 'Compartí el acceso al timbre de tu casa.' },
    devices: { title: 'Dispositivos', detail: 'Los celulares que reciben tu timbre.' },
    residents: { title: 'Residentes', detail: 'Las personas que comparten esta vivienda.' },
    settings: { title: 'Configuración', detail: 'Elegí cómo funciona el timbre de tu casa.' },
  };
  const pendingVisits = data.visits.filter((visit) => !visit.answered_at && now !== null && now - new Date(visit.created_at).getTime() < DOORBELL.responseWindowSeconds * 1000);

  useEffect(() => {
    const update = () => { const selected = getDashboardView(window.location.search, window.location.hash); setView(selected === 'residents' && !initial.isAdmin ? 'overview' : selected); };
    update(); window.addEventListener('popstate', update); window.addEventListener(DASHBOARD_VIEW_EVENT, update);
    return () => { window.removeEventListener('popstate', update); window.removeEventListener(DASHBOARD_VIEW_EVENT, update); };
  }, []);

  useEffect(() => { let active = true; QRCode.toDataURL(url, { width: 768, margin: 2, color: { dark: '#252a28', light: '#ffffff' } }).then((image) => { if (active) setQr(image); }).catch(() => setError('No pudimos generar el QR. Recargá la página.')); return () => { active = false; }; }, [url]);
  useEffect(() => {
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    async function refresh() {
      setNow(Date.now());
      if (document.visibilityState === 'visible' && !actionLock.current) {
        const generation = refreshGeneration.current;
        controller = new AbortController();
        try { const fresh = await api<Pick<DashboardData, 'home' | 'visits' | 'devices'>>('dashboard', undefined, controller.signal); if (!stopped && !actionLock.current && generation === refreshGeneration.current) setData((previous) => ({ ...previous, ...fresh })); }
        catch (error) { if (!controller.signal.aborted && !stopped) setError(error instanceof Error ? error.message : 'No pudimos actualizar.'); }
      }
      if (!stopped) timer = setTimeout(refresh, DOORBELL.pollIntervalMs);
    }
    setNow(Date.now()); timer = setTimeout(refresh, DOORBELL.pollIntervalMs);
    setNotificationState('Notification' in window ? Notification.permission : 'unsupported');
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
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

  async function action(key: string, work: () => Promise<unknown>, success: string) {
    if (actionLock.current) return false;
    actionLock.current = true; refreshGeneration.current += 1; setPending(key); setError(''); setFeedback('');
    try {
      await work();
      const fresh = await api<Pick<DashboardData, 'home' | 'visits' | 'devices'>>('dashboard');
      setData((previous) => ({ ...previous, ...fresh })); setFeedback(success);
      if (key === 'name') router.refresh();
      return true;
    } catch (error) { setError(error instanceof Error ? error.message : 'No pudimos completar la acción. Reintentá.'); return false; }
    finally { setPending(''); actionLock.current = false; }
  }

  async function subscribe() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('En iPhone, agregá Ringgg a Inicio y abrila desde su ícono. Usá un navegador compatible con notificaciones.');
    if (!data.pushReady) throw new Error('Falta configurar las claves de notificaciones en el servidor. Consultá la guía del proyecto.');
    // Permission is requested before the first await to preserve the user gesture on iOS.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { setNotificationState(permission); throw new Error('No se habilitaron las notificaciones. Podés volver a intentarlo desde los ajustes del dispositivo.'); }
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const response = await fetch('/api/push-key');
    if (!response.ok) throw new Error('No pudimos cargar la configuración de notificaciones.');
    const { publicKey } = await response.json();
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
    await api('subscribe', { name: 'Mi celular', subscription: subscription.toJSON() });
    setNotificationState(Notification.permission);
  }

  return <>
    <header className="topbar"><span><House size={15} /> Mi espacio <span className="slash">/</span> <strong>{data.home.name}</strong></span><button className="text-button" disabled={!!pending} onClick={() => action('logout', async () => { const result = await authClient.signOut(); if (result.error) throw new Error('No pudimos cerrar tu sesión. Reintentá.'); window.location.assign('/'); }, '')}><LogOut size={16} /> Salir</button></header>
    <main className="dashboard-main" id="main" data-view={view}>
      <div className="page-heading"><div><span className="eyebrow">UN POCO MÁS CERCA</span><h1>{sectionTitles[view].title}<span>.</span></h1><p>{sectionTitles[view].detail}</p></div><span className={`status-pill ${data.home.enabled ? 'active' : ''}`}><i />{data.home.enabled ? 'Timbre activo' : 'Timbre en pausa'}</span></div>
      {showNotificationSetup && <NotificationOnboarding permission={notificationState} pending={!!pending} error={error} onRefresh={() => { setError(''); setNotificationState('Notification' in window ? Notification.permission : 'unsupported'); }} onSignOut={() => { void action('logout', async () => { const result = await authClient.signOut(); if (result.error) throw new Error('No pudimos cerrar tu sesión. Reintentá.'); window.location.assign('/'); }, ''); }} onActivate={() => { void action('subscribe', subscribe, 'Dispositivo conectado. Enviá una prueba para comprobarlo.').then((success) => { if (success) setShowNotificationSetup(false); }); }} />}
      <div className="feedback-wrap" aria-live="polite">{feedback && <p className="feedback success"><Check size={17} />{feedback}<button aria-label="Cerrar aviso" onClick={() => setFeedback('')}><X size={16} /></button></p>}{error && <p className="feedback error" role="alert">{error}<button aria-label="Cerrar error" onClick={() => setError('')}><X size={16} /></button></p>}</div>
      <div className="dashboard-grid"><div className="primary-column">
        <section className="door-overview" aria-labelledby="door-title"><div className="overview-copy"><span className="label-caps">TU TIMBRE DIGITAL</span><h2 id="door-title">Una puerta.<br />Muchas formas<br />de estar cerca.</h2><p>Un QR en la entrada.<br />Un aviso directo a tu celular.</p><a href={url} target="_blank" rel="noreferrer" className="button dark">Ver mi timbre <ArrowUpRight size={18} /></a></div><div className="door-art" aria-hidden="true"><div className="art-arch"><div className="art-door"><span className="door-panel" /><span className="door-knob" /></div><div className="art-doorbell"><Bell size={18} /></div></div><span className="art-ring ring-one" /><span className="art-ring ring-two" /><div className="art-note"><span className="note-bell"><BellRing size={20} /></span><span><strong>¡Ding, dong!</strong><small>Alguien está en la puerta</small></span></div><span className="art-star">✳</span></div></section>
        <div className="quick-stats"><div><span className="stat-icon"><BellRing size={19} /></span><div><strong>{data.visits.length}</strong><span>Timbrazos recientes</span></div></div><div><span className="stat-icon"><Smartphone size={19} /></span><div><strong>{data.devices.length}</strong><span>Dispositivos conectados</span></div></div><div><span className="stat-icon"><CheckCheck size={19} /></span><div><strong>{data.visits.filter((visit) => visit.answered_at).length}</strong><span>Visitas atendidas</span></div></div></div>
        <section id="history" className="history section-block"><div className="section-title"><div><h2>En tu puerta</h2><p>Los últimos timbrazos de tu casa.</p></div><span className="count-badge">{data.visits.length}</span></div>
          {data.visits.length === 0 ? <div className="empty-visits"><div className="empty-icon"><Bell size={27} /></div><h3>Por ahora, todo tranquilo</h3><p>Cuando alguien toque tu timbre, lo vas a ver acá.</p><a href={url} target="_blank" rel="noreferrer">Probá tu primer timbrazo <ArrowUpRight size={15} /></a></div> : <div className="visit-list">{data.visits.map((visit) => { const waiting = pendingVisits.some((item) => item.id === visit.id); return <article key={visit.id} className={`visit-row ${waiting ? 'waiting' : ''}`}><div className="visit-icon"><BellRing size={20} /></div><div className="visit-info"><h3>{visit.message || 'Alguien tocó el timbre'}</h3><time dateTime={visit.created_at}>{visitTime(visit.created_at)}</time></div>{visit.answered_at ? <span className="visit-status"><Check size={14} /> Atendido</span> : waiting ? <button className="button primary small" disabled={!!pending} onClick={() => action(`answer-${visit.id}`, () => api('answer', { id: visit.id }), 'Tu visita ya sabe que estás en camino.')}>{pending === `answer-${visit.id}` ? 'Enviando…' : 'Ya voy'}</button> : <span className="visit-status muted">Sin respuesta</span>}</article>; })}</div>}
          <p className="section-footnote">Hasta 50 timbrazos · Historial de los últimos 30 días</p>
        </section>
      </div><aside className="context-column">
        <section className="qr-section" id="qr"><div className="section-title"><h2>Tu puerta de entrada</h2><QrCode size={20} /></div><p>Escaneá. Tocá. Ya estás cerca.</p><div className="qr-frame">{qr ? <img src={qr} width={184} height={184} alt={`QR para tocar el timbre de ${data.home.name}`} /> : <div className="skeleton qr-skeleton" />}</div><strong className="qr-home">{data.home.name}</strong><span className="qr-caption">No hace falta descargar ninguna app.</span><a className={`button outline full ${!qr ? 'disabled' : ''}`} href={qr || undefined} download="ringgg-mi-timbre.png"><ArrowDownToLine size={17} /> Descargar QR</a><button className="text-button centered" onClick={async () => { try { await navigator.clipboard.writeText(url); setFeedback('Enlace del timbre copiado.'); } catch { setError('No pudimos copiarlo. Abrí tu timbre y copiá la dirección.'); } }}><Copy size={15} /> Copiar enlace</button><div className="setting-row"><div><h3>Un enlace nuevo</h3><p>Regenerar el QR desactiva el anterior. Vas a tener que volver a imprimirlo.</p></div><button className="text-button" disabled={!!pending} onClick={() => setConfirmRotation(true)}><RefreshCw size={16} /> Regenerar QR</button></div>{confirmRotation && <div className="confirm-box" role="alert"><p>El QR pegado en tu puerta dejará de funcionar. ¿Querés crear uno nuevo?</p><button className="button primary small" disabled={!!pending} onClick={() => action('rotate', () => api('rotate', {}), 'Nuevo QR creado. Descargalo y reemplazá el anterior.').then(() => setConfirmRotation(false))}>Sí, crear nuevo QR</button><button className="text-button" onClick={() => setConfirmRotation(false)}>Cancelar</button></div>}</section>
        <section className="setup-callout"><span className="soft-icon"><Smartphone size={21} /></span><h3>Tu timbre va con vos</h3><p>Activá las notificaciones en este celular para enterarte cuando alguien llega.</p><a className="text-link" href="/?view=devices">Configurar mi celular <ArrowUpRight size={16} /></a></section>
        <div className="privacy-note"><ShieldCheck size={18} /><p>Tu casa, tu privacidad.<br /><span>Tu QR no comparte tus datos.</span></p></div>
      </aside></div>
      <section id="devices" className="section-block lower-section"><div className="section-title"><div><span className="eyebrow">QUE NO SE TE ESCAPE UN DING</span><h2>Los celulares de tu casa</h2><p>Todos reciben el aviso. Cualquiera puede responder.</p></div><Laptop size={25} /></div>{data.devices.length === 0 && <p className="section-footnote">Todavía no hay dispositivos conectados. El historial funciona; para recibir avisos con la app cerrada, conectá tu celular.</p>}{data.devices.map((device) => <div className="device-row" key={device.id}><Smartphone size={23} /><div><strong>{device.name}</strong><span>Conectado a tu casa</span></div><button className="text-button" disabled={!!pending} onClick={() => action(`test-${device.id}`, () => api('test-push', { id: device.id }), 'El servicio aceptó la prueba. Revisá el celular; la entrega depende de su conexión y ajustes.')}><Bell size={16} /> Probar aviso</button>{confirmRemoval === device.id ? <><span>¿Desconectar?</span><button className="text-button danger" disabled={!!pending} onClick={() => action(`remove-${device.id}`, () => api('remove-device', { id: device.id }), 'Dispositivo desconectado.').then(() => setConfirmRemoval(''))}>Sí</button><button className="text-button" onClick={() => setConfirmRemoval('')}>Cancelar</button></> : <button className="icon-button" aria-label={`Desconectar ${device.name}`} onClick={() => setConfirmRemoval(device.id)}><Trash2 size={17} /></button>}</div>)}</section>
      <section id="settings" className="section-block lower-section"><div className="section-title"><div><h2>Como en tu casa</h2><p>Los pequeños ajustes que hacen la diferencia.</p></div><Settings2 size={23} /></div><form onSubmit={(event) => { event.preventDefault(); void action('name', () => api('settings', { name, enabled: data.home.enabled }), 'Nombre actualizado.'); }}><label htmlFor="home-name">Nombre de tu casa</label><div className="inline-form"><input id="home-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={DOORBELL.nameMaxLength} /><button className="button outline" disabled={!!pending || !name.trim()}>{pending === 'name' ? 'Guardando…' : 'Guardar nombre'}</button></div></form><DoorbellPauseControl enabled={data.home.enabled} pending={!!pending} onPause={() => action('pause', () => api('settings', { name: data.home.name, enabled: false }), 'Timbre pausado.')} onResume={() => action('pause', () => api('settings', { name: data.home.name, enabled: true }), 'Timbre activado.')} /></section>
      {data.isAdmin && <ResidentManagement initial={initial.residents} />}
      <footer className="dashboard-footer"><span>ringgg. <span>Una forma más simple de llegar.</span></span><span>Hecho para estar cerca <span className="orange">✳</span></span></footer>
      {pending && <span className="operation-status" role="status"><LoaderCircle className="spin" size={15} /> Procesando…</span>}
    </main>
  </>;
}
