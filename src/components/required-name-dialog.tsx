'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cleanName } from '@/lib/names';

interface RequiredNameDialogProps {
  icon: ReactNode;
  eyebrow: string;
  /** Also the accessible name of the dialog. */
  title: ReactNode;
  description: ReactNode;
  label: string;
  initialName: string;
  maxLength: number;
  submitLabel: string;
  autoComplete?: string;
  pending: boolean;
  /** The server's answer, for example a name someone else already uses in this home. */
  error: string;
  /** A check that runs before saving, so a known problem never reaches the server: `''` when the name is fine. */
  validate?: (name: string) => string;
  onSave: (name: string) => void;
  onClearError: () => void;
  onSignOut: () => void;
}

/**
 * A name the panel cannot go on without: Escape does not close the dialog and saving needs a valid
 * name; signing out is the only other way out. Errors stay next to the field and clear as you type.
 */
export function RequiredNameDialog({ icon, eyebrow, title, description, label, initialName, maxLength, submitLabel, autoComplete = 'off', pending, error, validate, onSave, onClearError, onSignOut }: RequiredNameDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [name, setName] = useState(initialName);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  const clean = cleanName(name);
  const shown = problem || error;
  return <dialog ref={dialog} className="notification-onboarding name-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={(event) => event.preventDefault()}>
    <div className="notification-onboarding-icon">{icon}</div>
    <span className="eyebrow">{eyebrow}</span>
    <h2 id={`${id}-title`}>{title}</h2>
    <p id={`${id}-description`}>{description}</p>
    <form className="name-form" onSubmit={(event) => {
      event.preventDefault();
      if (!clean) return;
      const found = validate?.(clean) ?? '';
      if (found) { setProblem(found); return; }
      onSave(clean);
    }}>
      <label htmlFor={`${id}-input`}>{label}</label>
      <input id={`${id}-input`} value={name} required maxLength={maxLength} autoComplete={autoComplete} disabled={pending}
        aria-invalid={shown ? true : undefined} aria-describedby={shown ? `${id}-error` : undefined}
        onChange={(event) => { setName(event.target.value); setProblem(''); if (error) onClearError(); }} />
      {shown && <p id={`${id}-error`} className="field-error" role="alert">{shown}</p>}
      <button className="button primary notification-onboarding-primary" disabled={pending || !clean}>{pending ? 'Guardando…' : submitLabel}</button>
    </form>
    <button type="button" className="text-button notification-onboarding-later" disabled={pending} onClick={onSignOut}>Cerrar sesión</button>
  </dialog>;
}
