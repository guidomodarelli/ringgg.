'use client';
import { useId, useState, type ReactNode } from 'react';
import { DEVICES } from '@/constants/devices';
import { deviceNameProblem } from '@/lib/device-name';
import { cleanName } from '@/lib/names';
import { useDeviceNameSuggestion } from './dashboard/use-device-name-suggestion';

interface ConnectDeviceFormProps {
  /** How this home calls the resident, for the suggestion: «iPhone de Guido». */
  residentName: string;
  /** Names of the home's other devices: the new one cannot repeat them. */
  otherNames: string[];
  pending: boolean;
  className: string;
  buttonClassName: string;
  /** Content of the connect button, including its pending text. */
  children: ReactNode;
  onConnect: (name: string) => void;
}

/**
 * Connecting this device starts by naming it, so no device is left as «Mi celular». The name comes
 * prefilled and is required; the check runs before the browser asks for permission, so a generic or
 * repeated name never reaches the server. Connecting runs in the same click, which iOS needs.
 */
export function ConnectDeviceForm({ residentName, otherNames, pending, className, buttonClassName, children, onConnect }: ConnectDeviceFormProps) {
  const suggestion = useDeviceNameSuggestion(residentName, otherNames);
  const [typed, setTyped] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const id = useId();
  // Until the resident types, the field follows the suggestion, which knows the browser after hydration.
  const name = typed ?? suggestion;
  return <form className={className} onSubmit={(event) => {
    event.preventDefault();
    const found = deviceNameProblem(name, otherNames);
    if (found) { setProblem(found); return; }
    onConnect(cleanName(name));
  }}>
    <label htmlFor={`${id}-name`}>Nombre de este dispositivo</label>
    <input id={`${id}-name`} value={name} required maxLength={DEVICES.nameMaxLength} autoComplete="off" disabled={pending}
      aria-invalid={problem ? true : undefined} aria-describedby={problem ? `${id}-error` : undefined}
      onChange={(event) => { setTyped(event.target.value); setProblem(''); }} />
    {problem && <p id={`${id}-error`} className="field-error" role="alert">{problem}</p>}
    <button className={buttonClassName} disabled={pending || !cleanName(name)}>{children}</button>
  </form>;
}
