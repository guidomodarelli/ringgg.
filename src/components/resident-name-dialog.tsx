'use client';
import { useEffect, useRef, useState } from 'react';
import { UserRound } from 'lucide-react';
import { RESIDENT_NAMES } from '@/constants/homes';
import { cleanName } from '@/lib/names';

interface ResidentNameDialogProps {
  homeName: string;
  /** Prefill: the name used in another home or the account name. */
  suggestedName: string;
  pending: boolean;
  /** The server's answer, for example a name another resident of this home already uses. */
  error: string;
  onSave: (name: string) => void;
  onClearError: () => void;
  onSignOut: () => void;
}

/**
 * "¿Quién sos?": the first time in a home, the resident chooses how the others see them. It is
 * mandatory: Escape does not close it and saving needs a name; signing out is the only other way out.
 */
export function ResidentNameDialog({ homeName, suggestedName, pending, error, onSave, onClearError, onSignOut }: ResidentNameDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(suggestedName);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  const clean = cleanName(name);
  return <dialog ref={dialog} className="notification-onboarding resident-name-dialog" aria-labelledby="resident-name-title" aria-describedby="resident-name-description" onCancel={(event) => event.preventDefault()}>
    <div className="notification-onboarding-icon"><UserRound size={36} /></div>
    <span className="eyebrow">ANTES DE EMPEZAR</span>
    <h2 id="resident-name-title">¿Quién sos<span>?</span></h2>
    <p id="resident-name-description">Así te van a ver los demás residentes de «{homeName}»: en tus celulares, en quién respondió cada timbrazo y en la lista de residentes.</p>
    <form className="resident-name-form" onSubmit={(event) => { event.preventDefault(); if (clean) onSave(clean); }}>
      <label htmlFor="resident-name-input">Tu nombre</label>
      <input id="resident-name-input" value={name} required maxLength={RESIDENT_NAMES.maxLength} autoComplete="nickname" disabled={pending}
        aria-invalid={error ? true : undefined} aria-describedby={error ? 'resident-name-error' : undefined}
        onChange={(event) => { setName(event.target.value); if (error) onClearError(); }} />
      {error && <p id="resident-name-error" className="field-error" role="alert">{error}</p>}
      <button className="button primary notification-onboarding-primary" disabled={pending || !clean}>{pending ? 'Guardando…' : 'Guardar mi nombre'}</button>
    </form>
    <button type="button" className="text-button notification-onboarding-later" disabled={pending} onClick={onSignOut}>Cerrar sesión</button>
  </dialog>;
}
