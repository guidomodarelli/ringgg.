'use client';
import { Smartphone } from 'lucide-react';
import { DEVICES } from '@/constants/devices';
import { deviceNameProblem } from '@/lib/device-name';
import { RequiredNameDialog } from './required-name-dialog';
import { useDeviceNameSuggestion } from './dashboard/use-device-name-suggestion';

interface DeviceNameDialogProps {
  homeName: string;
  /** The generic name it has now, such as «Mi celular». */
  currentName: string;
  /** How this home calls the resident, for the suggestion: «iPhone de Guido». */
  residentName: string;
  /** Names of the home's other devices: this one cannot repeat them. */
  otherNames: string[];
  pending: boolean;
  /** The server's answer, for example a name another device took meanwhile. */
  error: string;
  onSave: (name: string) => void;
  onClearError: () => void;
  onSignOut: () => void;
}

/**
 * This browser rings for the home under a generic name («Mi celular»), from before devices were named
 * when connected: the first time it opens the panel, it gets a name that tells it apart.
 */
export function DeviceNameDialog({ homeName, currentName, residentName, otherNames, pending, error, onSave, onClearError, onSignOut }: DeviceNameDialogProps) {
  const suggestion = useDeviceNameSuggestion(residentName, otherNames);
  return <RequiredNameDialog icon={<Smartphone size={36} />} eyebrow="UN ÚLTIMO PASO" title={<>¿Cómo se llama este dispositivo<span>?</span></>}
    description={`En «${homeName}» figura como «${currentName}». Ponele un nombre que lo distinga, así todos saben qué celular avisa.`}
    label="Nombre de este dispositivo" initialName={suggestion} maxLength={DEVICES.nameMaxLength} submitLabel="Guardar nombre"
    validate={(name) => deviceNameProblem(name, otherNames)}
    pending={pending} error={error} onSave={onSave} onClearError={onClearError} onSignOut={onSignOut} />;
}
