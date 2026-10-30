'use client';
import { useState } from 'react';
import { LocateFixed, MapPin } from 'lucide-react';
import { NEARBY_RINGING } from '@/constants/location';
import type { DashboardSnapshot, HomeState } from '@/types/doorbell';
import { api } from '@/lib/api';
import { currentPosition, locationFailure, type LocationFailure } from '@/lib/browser-location';
import type { RunAction } from './types';

/** Why the resident's phone gave no reading, in the words of the settings screen. */
const RESIDENT_LOCATION_FAILURES: Record<LocationFailure, string> = {
  unsupported: 'Este navegador no puede compartir la ubicación. Probá desde el celular, con Safari o Chrome.',
  denied: 'La ubicación está bloqueada para Ringgg. Permitila en los ajustes del navegador y volvé a intentar.',
  unavailable: 'Tu celular no encontró tu ubicación. Revisá que esté activada y volvé a intentar.',
  timeout: 'Tu celular tardó demasiado en encontrar tu ubicación. Volvé a intentar con la ubicación activada.',
};

function toggleLabel(home: HomeState, pending: string) {
  if (pending === 'location-nearby') return 'Guardando…';
  return home.nearby_only ? 'Desactivar' : 'Activar';
}

function saveSpotLabel(saved: boolean, locating: boolean, pending: string) {
  if (locating) return 'Buscando tu ubicación…';
  if (pending === 'location-set') return 'Guardando…';
  return saved ? 'Actualizar con mi ubicación actual' : 'Guardar mi ubicación actual';
}

function locationDescription(home: HomeState, saved: boolean) {
  if (!saved) return `Guardá la ubicación de la casa parado en la puerta. Después podés pedir que solo se pueda tocar el timbre a menos de ${NEARBY_RINGING.radiusMeters} m.`;
  if (home.nearby_only) return `Activado: solo se puede tocar el timbre a menos de ${NEARBY_RINGING.radiusMeters} m de la puerta. La visita tiene que permitir su ubicación, que no se guarda.`;
  return 'Ubicación guardada. Por ahora cualquiera con el QR puede tocar desde donde esté.';
}

/**
 * Ringing only from near the door. Saving the spot reads this phone's location first (a pending step
 * with its own message), then the server confirms; turning the requirement on needs a saved spot.
 */
export function LocationSetting({ home, pending, run }: { home: HomeState; pending: string; run: RunAction }) {
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState('');
  const saved = home.latitude !== null && home.longitude !== null;
  const busy = Boolean(pending) || locating;
  async function saveCurrentSpot() {
    setProblem(''); setLocating(true);
    let position;
    try { position = await currentPosition(); }
    catch (error) { setProblem(RESIDENT_LOCATION_FAILURES[locationFailure(error)]); return; }
    finally { setLocating(false); }
    await run('location-set', () => api<DashboardSnapshot>('location', { home: home.id, action: 'set', position }), `Ubicación de la puerta guardada (precisión ±${Math.round(position.accuracy)} m).`, 'snapshot');
  }
  const toggle = () => run('location-nearby', () => api<DashboardSnapshot>('location', { home: home.id, action: 'nearby', enabled: !home.nearby_only }), home.nearby_only ? 'Listo: se puede tocar el timbre desde cualquier lugar.' : 'Listo: solo se puede tocar el timbre desde la puerta.', 'snapshot');
  const clear = () => run('location-clear', () => api<DashboardSnapshot>('location', { home: home.id, action: 'clear' }), 'Ubicación de la casa borrada.', 'snapshot');
  return <div className="location-setting">
    <div className="setting-row"><div><h3 id="location-title"><MapPin size={15} aria-hidden="true" /> Tocar solo desde la puerta</h3><p>{locationDescription(home, saved)}</p></div>
      {saved && <button type="button" className={`button ${home.nearby_only ? 'outline' : 'primary'}`} disabled={busy} aria-pressed={home.nearby_only} onClick={() => { void toggle(); }}>
        {toggleLabel(home, pending)}
      </button>}
    </div>
    <div className="location-actions">
      <button type="button" className="text-button" disabled={busy} onClick={() => { void saveCurrentSpot(); }}><LocateFixed size={16} />
        {saveSpotLabel(saved, locating, pending)}
      </button>
      {saved && <button type="button" className="text-button danger" disabled={busy} onClick={() => { void clear(); }}>{pending === 'location-clear' ? 'Borrando…' : 'Borrar ubicación'}</button>}
    </div>
    {problem && <p className="field-error" role="alert">{problem}</p>}
    {saved && <p className="section-footnote">La ubicación la informa el celular de la visita: frena los timbrazos a distancia, pero alguien decidido podría falsearla.</p>}
  </div>;
}
