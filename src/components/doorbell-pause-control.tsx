'use client';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { PAUSE_OPTIONS, type PauseMode } from '@/constants/doorbell';
import { pauseEndLabel } from '@/lib/pause';

interface DoorbellPauseControlProps {
  paused: boolean;
  /** End of a pause that resumes on its own; `null` while active or paused until someone resumes it. */
  pausedUntil: string | null;
  /** Key of the running action, so only the chosen option shows its progress. */
  pending: string;
  onPause: (mode: Exclude<PauseMode, 'resume'>) => Promise<boolean>;
  onResume: () => Promise<boolean>;
}

function toggleLabel(paused: boolean, pending: string) {
  if (!paused) return 'Pausar timbre';
  return pending === 'pause-resume' ? 'Activando…' : 'Activar timbre';
}

/** Pausing asks for how long; resuming is an immediate server-confirmed action. */
export function DoorbellPauseControl({ paused, pausedUntil, pending, onPause, onResume }: DoorbellPauseControlProps) {
  const [choosing, setChoosing] = useState(false);
  const firstOption = useRef<HTMLButtonElement>(null);
  // The options only belong to an active bell: a pause, from here or from another resident, hides them.
  const showOptions = choosing && !paused;
  useEffect(() => { if (showOptions) firstOption.current?.focus(); }, [showOptions]);
  const busy = Boolean(pending);
  const description = paused
    ? `El timbre está en pausa ${pausedUntil ? pauseEndLabel(pausedUntil) : 'hasta que lo reactives'}: las visitas no pueden avisarte.`
    : 'Pausá el timbre cuando no quieras recibir avisos.';
  function toggle() {
    if (!paused) { setChoosing(true); return; }
    setChoosing(false);
    void onResume();
  }
  return <>
    <div className="setting-row">
      <div><h3>{paused ? '¿Listo para recibir visitas?' : 'Un momento de tranquilidad'}</h3><p>{description}</p></div>
      <button type="button" className="button outline" disabled={busy} aria-expanded={paused ? undefined : showOptions} aria-controls={paused ? undefined : 'pause-options'} onClick={toggle}>
        {paused ? <Play size={16} /> : <Pause size={16} />}{toggleLabel(paused, pending)}
      </button>
    </div>
    {showOptions && <div id="pause-options" className="confirm-box pause-options" role="group" aria-labelledby="pause-options-title">
      <p id="pause-options-title">Mientras el timbre esté pausado, las visitas no podrán enviar avisos. ¿Por cuánto tiempo?</p>
      <div className="pause-choices">
        {PAUSE_OPTIONS.map((option, index) => <button key={option.mode} ref={index === 0 ? firstOption : undefined} type="button" className="button primary small" disabled={busy} onClick={() => { void onPause(option.mode).then((saved) => { if (saved) setChoosing(false); }); }}>
          {pending === `pause-${option.mode}` ? 'Pausando…' : option.label}
        </button>)}
        <button type="button" className="text-button" disabled={busy} onClick={() => setChoosing(false)}>Cancelar</button>
      </div>
    </div>}
  </>;
}
