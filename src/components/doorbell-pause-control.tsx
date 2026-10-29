'use client';
import { useEffect, useState } from 'react';
import { Pause, Play } from 'lucide-react';

/** Pausing needs confirmation; reactivation is an immediate server-confirmed action. */
export function DoorbellPauseControl({ enabled, pending, onPause, onResume }: { enabled: boolean; pending: boolean; onPause: () => Promise<boolean>; onResume: () => Promise<boolean> }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { if (!enabled) setConfirming(false); }, [enabled]);
  return <><div className="setting-row"><div><h3>{enabled ? 'Un momento de tranquilidad' : '¿Listo para recibir visitas?'}</h3><p>{enabled ? 'Pausá el timbre cuando no quieras recibir avisos.' : 'Reactivá el timbre para que puedan avisarte.'}</p></div><button type="button" className="button outline" disabled={pending} aria-expanded={enabled ? confirming : undefined} aria-controls={enabled ? 'pause-confirmation' : undefined} onClick={() => { if (enabled) setConfirming(true); else void onResume(); }}>{enabled ? <Pause size={16} /> : <Play size={16} />}{enabled ? 'Pausar timbre' : 'Activar timbre'}</button></div>
    {confirming && enabled && <div id="pause-confirmation" className="confirm-box" role="alert"><p>Mientras el timbre esté pausado, las visitas no podrán enviar avisos. ¿Querés pausarlo?</p><button type="button" className="button primary small" disabled={pending} onClick={() => { void onPause().then((success) => { if (success) setConfirming(false); }); }}>{pending ? 'Pausando…' : 'Sí, pausar timbre'}</button><button type="button" className="text-button" disabled={pending} onClick={() => setConfirming(false)}>Cancelar</button></div>}
  </>;
}
