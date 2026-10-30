'use client';
import { UserRound } from 'lucide-react';
import { RESIDENT_NAMES } from '@/constants/homes';
import { RequiredNameDialog } from './required-name-dialog';

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

/** "¿Quién sos?": the first time in a home, the resident chooses how the others see them. */
export function ResidentNameDialog({ homeName, suggestedName, pending, error, onSave, onClearError, onSignOut }: ResidentNameDialogProps) {
  return <RequiredNameDialog icon={<UserRound size={36} />} eyebrow="ANTES DE EMPEZAR" title={<>¿Quién sos<span>?</span></>}
    description={`Así te van a ver los demás residentes de «${homeName}»: en tus celulares, en quién respondió cada timbrazo y en la lista de residentes.`}
    label="Tu nombre" initialName={suggestedName} maxLength={RESIDENT_NAMES.maxLength} submitLabel="Guardar mi nombre" autoComplete="nickname"
    pending={pending} error={error} onSave={onSave} onClearError={onClearError} onSignOut={onSignOut} />;
}
