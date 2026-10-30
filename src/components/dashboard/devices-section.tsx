import { useState } from 'react';
import { Bell, BellRing, Laptop, Pencil, Smartphone, Trash2 } from 'lucide-react';
import { DEVICES } from '@/constants/devices';
import type { DashboardSnapshot, Device } from '@/types/doorbell';
import { api } from '@/lib/api';
import { deviceHealth } from '@/lib/device-health';
import { deviceNameProblem } from '@/lib/device-name';
import { ConnectDeviceForm } from '../connect-device-form';
import type { RunAction } from './types';

interface NotificationState { active: boolean; permission: string; skipped: boolean }

const RENAME_ACTION_PREFIX = 'rename-';

/** The action that renames one device; its error shows next to the name field. */
function renameAction(deviceId: string) {
  return `${RENAME_ACTION_PREFIX}${deviceId}`;
}

/** Whether a failed action is a device rename, whose form already shows the error. */
export function isDeviceRename(actionKey: string) {
  return actionKey.startsWith(RENAME_ACTION_PREFIX);
}

function testOutcome(result: unknown) {
  const { accepted, total } = result as { accepted: number; total: number };
  return accepted < total ? `Enviamos la prueba a ${accepted} de tus ${total} celulares. Revisalos.` : 'Enviamos la prueba a tus celulares. Revisalos.';
}

/** Why this browser does not ring: it cannot, the resident blocked it, or it is not activated yet. */
function calloutDetail(permission: string) {
  if (permission === 'unsupported') return 'En iPhone, agregá Ringgg a Inicio y abrila desde su ícono para activarlos.';
  if (permission === 'denied') return 'Las notificaciones están bloqueadas: habilitalas en los ajustes del navegador o del celular.';
  // The permission covers the browser; each home still needs this device connected to it.
  if (permission === 'granted') return 'El navegador ya tiene permiso: falta conectarlo a esta casa.';
  return 'Activalos para enterarte cuando alguien llega, aunque Ringgg esté cerrada.';
}

interface ThisDeviceCalloutProps {
  notifications: NotificationState;
  residentName: string;
  otherNames: string[];
  pending: boolean;
  onActivate: (name: string) => void;
}

/** Explains why this browser does not ring and offers the way out that applies: naming and connecting it. */
function ThisDeviceCallout({ notifications, residentName, otherNames, pending, onActivate }: ThisDeviceCalloutProps) {
  if (notifications.active) return null;
  const blocked = notifications.permission === 'denied';
  const unsupported = notifications.permission === 'unsupported';
  const action = notifications.permission === 'granted' ? 'Conectar este dispositivo' : 'Activar notificaciones en este dispositivo';
  return <div className="device-callout">
    <p><strong>Este dispositivo no recibe avisos de esta casa.</strong> {calloutDetail(notifications.permission)}</p>
    {!blocked && !unsupported && <ConnectDeviceForm className="name-form device-connect-form" buttonClassName="button primary small" residentName={residentName} otherNames={otherNames} pending={pending} onConnect={onActivate}>
      <BellRing size={16} /> {pending ? 'Conectando…' : action}
    </ConnectDeviceForm>}
  </div>;
}

interface RenameFormProps {
  device: Device;
  homeId: number;
  /** Names of the home's other devices: this one cannot repeat them. */
  otherNames: string[];
  pending: string;
  run: RunAction;
  error: string;
  onClearError: () => void;
  onDone: () => void;
}

/**
 * The name is required, not generic and unique in the home: a known problem is shown next to the field
 * before any request, and the server's answer (another device took it meanwhile) lands in the same place.
 */
function RenameForm({ device, homeId, otherNames, pending, run, error, onClearError, onDone }: RenameFormProps) {
  const [name, setName] = useState(device.name);
  const [problem, setProblem] = useState('');
  const key = renameAction(device.id);
  const errorId = `device-name-error-${device.id}`;
  const shown = problem || error;
  return <form className="device-rename" onSubmit={(event) => {
    event.preventDefault();
    const found = deviceNameProblem(name, otherNames);
    if (found) { setProblem(found); return; }
    void run(key, () => api<DashboardSnapshot>('rename-device', { home: homeId, id: device.id, name }), 'Nombre del celular actualizado.', 'snapshot').then((saved) => { if (saved) onDone(); });
  }}>
    <label htmlFor={`device-name-${device.id}`}>Nombre del celular</label>
    <div className="inline-form">
      <input id={`device-name-${device.id}`} value={name} required maxLength={DEVICES.nameMaxLength} disabled={pending === key}
        aria-invalid={shown ? true : undefined} aria-describedby={shown ? errorId : undefined}
        onChange={(event) => { setName(event.target.value); setProblem(''); if (error) onClearError(); }} />
      <button className="button outline small" disabled={Boolean(pending) || !name.trim()}>{pending === key ? 'Guardando…' : 'Guardar'}</button>
      <button type="button" className="text-button" disabled={pending === key} onClick={onDone}>Cancelar</button>
    </div>
    {shown && <p id={errorId} className="field-error" role="alert">{shown}</p>}
  </form>;
}

interface DevicesSectionProps {
  homeId: number;
  devices: Device[];
  thisDeviceId: string | null;
  notifications: NotificationState;
  /** How this home calls the resident, for the suggested name of this device. */
  residentName: string;
  pending: string;
  run: RunAction;
  error: string;
  failedAction: string;
  onClearError: () => void;
  /** Connects this device with the name the resident gave it. */
  onActivate: (name: string) => void;
}

export function DevicesSection({ homeId, devices, thisDeviceId, notifications, residentName, pending, run, error, failedAction, onClearError, onActivate }: DevicesSectionProps) {
  const [confirmRemoval, setConfirmRemoval] = useState('');
  const [renaming, setRenaming] = useState('');
  const busy = Boolean(pending);
  return <section id="devices" className="section-block lower-section">
    <div className="section-title"><div><span className="eyebrow">QUE NO SE TE ESCAPE UN DING</span><h2>Los celulares de tu casa</h2><p>Todos reciben el aviso. Cualquiera puede responder.</p></div><Laptop size={25} /></div>
    <ThisDeviceCallout notifications={notifications} residentName={residentName} otherNames={devices.map((item) => item.name)} pending={busy} onActivate={onActivate} />
    {devices.length === 0
      ? <p className="section-footnote">Todavía no hay dispositivos conectados. El historial funciona; para recibir avisos con la app cerrada, conectá tu celular.</p>
      : <button type="button" className="button outline small device-test-mine" disabled={busy} onClick={() => run('test-mine', () => api('test-my-devices', { home: homeId }), testOutcome, 'none')}><Bell size={16} /> {pending === 'test-mine' ? 'Enviando prueba…' : 'Probar mis celulares'}</button>}
    {devices.map((device) => {
      const health = deviceHealth(device);
      return <div className="device-row" key={device.id}>
        <Smartphone size={23} />
        {renaming === device.id
          ? <RenameForm device={device} homeId={homeId} otherNames={devices.filter((item) => item.id !== device.id).map((item) => item.name)} pending={pending} error={failedAction === renameAction(device.id) ? error : ''} onClearError={onClearError} run={run} onDone={() => setRenaming('')} />
          : <div className="device-info">
            <strong>{device.name}{device.id === thisDeviceId && <span className="device-badge">Este dispositivo</span>}</strong>
            <span>{device.owner ? `De ${device.owner}` : 'Sin dueño asignado'}</span>
            <span className={`device-health ${health.tone}`}>{health.text}</span>
          </div>}
        {renaming !== device.id && <div className="device-actions">
          <button className="text-button" disabled={busy} onClick={() => run(`test-${device.id}`, () => api('test-push', { home: homeId, id: device.id }), 'El servicio aceptó la prueba. Revisá el celular; la entrega depende de su conexión y ajustes.', 'refetch')}><Bell size={16} /> Probar aviso</button>
          <button className="text-button" disabled={busy} aria-label={`Renombrar ${device.name}`} onClick={() => { setRenaming(device.id); setConfirmRemoval(''); }}><Pencil size={15} /> Renombrar</button>
          {confirmRemoval === device.id
            ? <><span>¿Desconectar?</span><button className="text-button danger" disabled={busy} onClick={() => { void run(`remove-${device.id}`, () => api('remove-device', { home: homeId, id: device.id }), 'Dispositivo desconectado.').then((success) => { if (success) setConfirmRemoval(''); }); }}>Sí</button><button className="text-button" onClick={() => setConfirmRemoval('')}>Cancelar</button></>
            : <button className="icon-button" aria-label={`Desconectar ${device.name}`} onClick={() => setConfirmRemoval(device.id)}><Trash2 size={17} /></button>}
        </div>}
      </div>;
    })}
  </section>;
}
