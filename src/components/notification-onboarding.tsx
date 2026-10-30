'use client';
import { useEffect, useRef } from 'react';
import { BellRing } from 'lucide-react';
import { ConnectDeviceForm } from './connect-device-form';

interface NotificationOnboardingProps {
  permission: string;
  /** The home this device would start ringing for. */
  homeName: string;
  /** How this home calls the resident, for the suggested device name. */
  residentName: string;
  /** Names of the home's devices: this one cannot repeat them. */
  otherDeviceNames: string[];
  pending: boolean;
  error: string;
  /** Connects this device with the name the resident gave it. */
  onActivate: (name: string) => void;
  onRefresh: () => void;
  /** Keeps using the panel on this device without notifications, for example on a computer. */
  onSkip: () => void;
  onSignOut: () => void;
}

/**
 * With the permission already granted, nothing is missing in the browser: this device just is not
 * connected to the home yet, so the copy says that instead of asking for notifications again.
 */
function onboardingCopy(permission: string, homeName: string, pending: boolean) {
  if (permission === 'granted') return {
    description: `Este navegador ya tiene permiso para mostrar notificaciones, pero todavía no está conectado a «${homeName}». Ponele un nombre y conectalo para que te avise cuando alguien llegue, incluso si Ringgg está cerrada o el teléfono está bloqueado.`,
    action: pending ? 'Conectando…' : 'Conectar este dispositivo',
  };
  return {
    description: `Ponele un nombre a este dispositivo y activá las notificaciones para que te avise cuando alguien llegue a «${homeName}», incluso si Ringgg está cerrada o el teléfono está bloqueado.`,
    action: pending ? 'Activando…' : 'Activar notificaciones',
  };
}

/** A native modal gives the activation step initial focus, keyboard containment and Escape behavior. */
export function NotificationOnboarding({ permission, homeName, residentName, otherDeviceNames, pending, error, onActivate, onRefresh, onSkip, onSignOut }: NotificationOnboardingProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  const blocked = permission === 'denied' || permission === 'unsupported';
  const copy = onboardingCopy(permission, homeName, pending);
  return <dialog ref={dialog} className="notification-onboarding" aria-labelledby="notification-onboarding-title" aria-describedby="notification-onboarding-description" onCancel={(event) => event.preventDefault()}>
    <div className="notification-onboarding-icon"><BellRing size={36} /></div>
    <span className="eyebrow">UN PASO PARA EMPEZAR</span>
    <h2 id="notification-onboarding-title">Que no se te escape<br />ninguna visita<span>.</span></h2>
    <p id="notification-onboarding-description">{copy.description}</p>
    {permission === 'unsupported' && <p className="notification-onboarding-help">En iPhone: Compartir → Agregar a Inicio y abrí Ringgg desde su ícono. En Android: abrila en un navegador compatible y permití las notificaciones.</p>}
    {permission === 'denied' && <p className="notification-onboarding-help">Las notificaciones están bloqueadas. Habilitalas en los ajustes del dispositivo y volvé a intentar.</p>}
    {error && <p className="feedback error" role="alert">{error}</p>}
    {blocked
      ? <button type="button" className="button primary notification-onboarding-primary" disabled={pending} onClick={onRefresh}>Volver a comprobar</button>
      : <ConnectDeviceForm className="name-form" buttonClassName="button primary notification-onboarding-primary" residentName={residentName} otherNames={otherDeviceNames} pending={pending} onConnect={onActivate}>{copy.action}</ConnectDeviceForm>}
    <button type="button" className="button outline notification-onboarding-skip" disabled={pending} onClick={onSkip}>Seguir sin avisos en este dispositivo</button>
    <p className="notification-onboarding-note">Podés activarlos después desde Dispositivos.</p>
    <button type="button" className="text-button notification-onboarding-later" disabled={pending} onClick={onSignOut}>Cerrar sesión</button>
  </dialog>;
}
