'use client';
import { useEffect, useRef } from 'react';
import { BellRing } from 'lucide-react';

/** A native modal gives the activation step initial focus, keyboard containment and Escape behavior. */
export function NotificationOnboarding({ permission, pending, error, onActivate, onRefresh, onSignOut }: { permission: string; pending: boolean; error: string; onActivate: () => void; onRefresh: () => void; onSignOut: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  return <dialog ref={dialog} className="notification-onboarding" aria-labelledby="notification-onboarding-title" aria-describedby="notification-onboarding-description" onCancel={(event) => event.preventDefault()}>
    <div className="notification-onboarding-icon"><BellRing size={36} /></div>
    <span className="eyebrow">UN PASO PARA EMPEZAR</span>
    <h2 id="notification-onboarding-title">Que no se te escape<br />ninguna visita<span>.</span></h2>
    <p id="notification-onboarding-description">Para usar el timbre, activá las notificaciones. Así tu celular te avisará cuando alguien llegue, incluso si Ringgg está cerrada o el teléfono está bloqueado.</p>
    {permission === 'unsupported' && <p className="notification-onboarding-help">En iPhone: Compartir → Agregar a Inicio y abrí Ringgg desde su ícono. En Android: abrila en un navegador compatible y permití las notificaciones.</p>}
    {permission === 'denied' && <p className="notification-onboarding-help">Las notificaciones están bloqueadas. Habilitalas en los ajustes del dispositivo y volvé a intentar.</p>}
    {error && <p className="feedback error" role="alert">{error}</p>}
    {permission === 'denied' || permission === 'unsupported' ? <button type="button" className="button primary notification-onboarding-primary" disabled={pending} onClick={onRefresh}>Volver a comprobar</button> : <button type="button" className="button primary notification-onboarding-primary" disabled={pending} onClick={onActivate}>{pending ? 'Activando…' : 'Activar notificaciones'}</button>}
    <button type="button" className="text-button notification-onboarding-later" disabled={pending} onClick={onSignOut}>Cerrar sesión</button>
  </dialog>;
}
