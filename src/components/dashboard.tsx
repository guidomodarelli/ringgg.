'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Check, House, LoaderCircle, LogOut, RefreshCw, ShieldCheck, Smartphone, X } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { ResidentManagement } from './resident-management';
import { NotificationOnboarding } from './notification-onboarding';
import { ResidentNameDialog } from './resident-name-dialog';
import { DeviceNameDialog } from './device-name-dialog';
import { HomeSwitcher } from './home-switcher';
import { DashboardSectionLink } from './dashboard-section-link';
import { DoorOverview } from './dashboard/door-overview';
import { VisitHistory } from './dashboard/visit-history';
import { QrPanel } from './dashboard/qr-panel';
import { DevicesSection, isDeviceRename } from './dashboard/devices-section';
import { SettingsSection } from './dashboard/settings-section';
import { useDashboardState } from './dashboard/use-dashboard-state';
import { useDashboardView, useFocusVisitId } from './dashboard/use-dashboard-view';
import { usePushDevice } from './dashboard/use-push-device';
import type { DashboardData, DashboardSnapshot, HomeState } from '@/types/doorbell';
import type { DashboardView } from '@/constants/dashboard-views';
import { pauseEnd, pauseEndLabel } from '@/lib/pause';
import { api } from '@/lib/api';
import { isGenericDeviceName } from '@/lib/device-name';
import type { ResidentEntry } from '@/types/residents';

const SECTION_TITLES: Record<DashboardView, { title: string; detail: string }> = {
  overview: { title: 'Tu casa te llama', detail: 'Todo lo que pasa en tu puerta, estés donde estés.' },
  history: { title: 'Timbrazos', detail: 'Las visitas recientes de tu casa.' },
  qr: { title: 'Tu código QR', detail: 'Compartí el acceso al timbre de tu casa.' },
  devices: { title: 'Dispositivos', detail: 'Los celulares que reciben tu timbre.' },
  residents: { title: 'Residentes', detail: 'Las personas que comparten esta vivienda.' },
  settings: { title: 'Configuración', detail: 'Elegí cómo funciona el timbre de tu casa.' },
};

/** Changes when the server-rendered roster changes (for example after a refresh), so the list starts from it again. */
function rosterKey(residents: ResidentEntry[]) {
  return residents.map((resident) => `${resident.email}:${resident.name ?? ''}`).join('|');
}

function statusLabel(home: HomeState) {
  if (home.paused) {
    const end = pauseEnd(home);
    return end ? `Timbre en pausa ${pauseEndLabel(end)}` : 'Timbre en pausa';
  }
  return home.quiet ? 'Horario de descanso' : 'Timbre activo';
}

export function Dashboard({ initial, initialView = 'overview' }: { initial: DashboardData; initialView?: DashboardView }) {
  const router = useRouter();
  const view = useDashboardView(initialView);
  const focusVisitId = useFocusVisitId(initial.focusVisitId ?? '');
  // Until the resident chooses a name in this home, "¿Quién sos?" comes before anything else.
  const [viewerName, setViewerName] = useState(initial.viewer.name);
  const residentName = viewerName ?? initial.viewer.suggestedName;
  const device = usePushDevice({ homeId: initial.home.id, pushReady: initial.pushReady });
  // This browser rings for the home only while the confirmed snapshot lists its device.
  const { data, pushActive, pending, feedback, setFeedback, error, setError, failedAction, syncError, now, run, retrySync } = useDashboardState(initial, device.deviceId);
  const url = `${data.origin}/t/${data.home.token}`;
  const busy = Boolean(pending);

  async function signOut() {
    const result = await authClient.signOut();
    if (result.error) throw new Error('No pudimos cerrar tu sesión. Reintentá.');
    router.replace('/');
    router.refresh();
  }
  /** Names of the home's devices except one: a device cannot repeat another's name. */
  const deviceNamesExcept = (deviceId: string | null) => data.devices.filter((item) => item.id !== deviceId).map((item) => item.name);
  const activateNotifications = (name: string) => { void run('subscribe', () => device.activate(name), `«${name}» quedó conectado. Enviá una prueba para comprobarlo.`); };
  const saveDeviceName = (deviceId: string, name: string) => {
    void run('device-name', () => api<DashboardSnapshot>('rename-device', { home: data.home.id, id: deviceId, name }), `Listo: este dispositivo ahora se llama «${name}».`, 'snapshot');
  };
  const saveViewerName = (name: string) => {
    void run('viewer-name', () => api('residents', { home: data.home.id, action: 'rename', email: initial.viewer.email, name }), `Listo, ${name}. Así te van a ver en esta casa.`).then((saved) => { if (saved) setViewerName(name); });
  };
  const available = !data.home.paused && !data.home.quiet;
  const naming = viewerName === null;
  // This browser, while it rings for the home. One still called «Mi celular» is named before going on.
  const thisDevice = data.devices.find((item) => item.id === device.deviceId);
  const deviceNaming = !naming && thisDevice !== undefined && isGenericDeviceName(thisDevice.name);
  const onboarding = !naming && !deviceNaming && device.showSetup;
  // A modal step or a form that shows an error next to its field keeps it there; the page shows the rest.
  const pageError = naming || deviceNaming || onboarding || isDeviceRename(failedAction) ? '' : error;

  return <>
    <header className="topbar">
      <span className="topbar-home"><House size={15} /> Mi espacio <span className="slash">/</span> <HomeSwitcher homes={initial.homes} currentId={data.home.id} currentName={data.home.name} /></span>
      <button className="text-button" disabled={busy} onClick={() => run('logout', signOut, '', 'none')}><LogOut size={16} /> Salir</button>
    </header>
    <main className="dashboard-main" id="main" data-view={view}>
      <div className="page-heading">
        <div><span className="eyebrow">UN POCO MÁS CERCA</span><h1>{SECTION_TITLES[view].title}<span>.</span></h1><p>{SECTION_TITLES[view].detail}</p></div>
        <span className={`status-pill ${available ? 'active' : ''}`}><i />{statusLabel(data.home)}</span>
      </div>
      {naming && <ResidentNameDialog homeName={data.home.name} suggestedName={initial.viewer.suggestedName} pending={busy} error={error}
        onSave={saveViewerName} onClearError={() => setError('')} onSignOut={() => { void run('logout', signOut, '', 'none'); }} />}
      {deviceNaming && <DeviceNameDialog homeName={data.home.name} currentName={thisDevice.name} residentName={residentName} otherNames={deviceNamesExcept(thisDevice.id)}
        pending={busy} error={error} onSave={(name) => saveDeviceName(thisDevice.id, name)} onClearError={() => setError('')} onSignOut={() => { void run('logout', signOut, '', 'none'); }} />}
      {onboarding && <NotificationOnboarding
        permission={device.permission} homeName={data.home.name} residentName={residentName} otherDeviceNames={deviceNamesExcept(device.deviceId)} pending={busy} error={error}
        onRefresh={() => { setError(''); device.refreshPermission(); }}
        onActivate={activateNotifications}
        onSkip={device.skip}
        onSignOut={() => { void run('logout', signOut, '', 'none'); }} />}
      <div className="feedback-wrap" aria-live="polite">
        {feedback && <p className="feedback success"><Check size={17} />{feedback}<button aria-label="Cerrar aviso" onClick={() => setFeedback('')}><X size={16} /></button></p>}
        {pageError && <p className="feedback error" role="alert">{pageError}<button aria-label="Cerrar error" onClick={() => setError('')}><X size={16} /></button></p>}
        {syncError && <p className="sync-notice">{syncError} Seguimos intentando solos.<button className="text-button" onClick={retrySync}><RefreshCw size={15} /> Reintentar ahora</button></p>}
      </div>
      <div className="dashboard-grid"><div className="primary-column">
        <DoorOverview url={url} data={data} />
        <VisitHistory visits={data.visits} now={now} url={url} pending={pending} run={run} focusVisitId={focusVisitId} />
      </div><aside className="context-column">
        <QrPanel url={url} homeId={data.home.id} homeName={data.home.name} pending={pending} run={run} onFeedback={setFeedback} onError={setError} />
        {!pushActive && <section className="setup-callout"><span className="soft-icon"><Smartphone size={21} /></span><h3>Tu timbre va con vos</h3><p>Activá las notificaciones en este celular para enterarte cuando alguien llega.</p><DashboardSectionLink className="text-link" view="devices" homeId={data.home.id}>Configurar mi celular <ArrowUpRight size={16} /></DashboardSectionLink></section>}
        <div className="privacy-note"><ShieldCheck size={18} /><p>Tu casa, tu privacidad.<br /><span>Tu QR no comparte tus datos.</span></p></div>
      </aside></div>
      <DevicesSection homeId={data.home.id} devices={data.devices} thisDeviceId={device.deviceId} notifications={{ active: pushActive, permission: device.permission, skipped: device.skipped }} residentName={residentName} pending={pending} run={run} error={error} failedAction={failedAction} onClearError={() => setError('')} onActivate={activateNotifications} />
      <SettingsSection home={data.home} homes={initial.homes.length} residents={initial.residents.length} pending={pending} run={run} />
      <ResidentManagement key={rosterKey(initial.residents)} homeId={data.home.id} initial={initial.residents} homeName={data.home.name} origin={data.origin} viewerEmail={initial.viewer.email} />
      <footer className="dashboard-footer"><span>ringgg. <span>Una forma más simple de llegar.</span></span><span>Hecho para estar cerca <span className="orange">✳</span></span></footer>
      {pending && <span className="operation-status" role="status"><LoaderCircle className="spin" size={15} /> Procesando…</span>}
    </main>
  </>;
}
