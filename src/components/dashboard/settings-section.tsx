import { useEffect, useState } from 'react';
import { Moon, Settings2 } from 'lucide-react';
import { DOORBELL } from '@/constants/doorbell';
import type { HomeState } from '@/types/doorbell';
import { api } from '@/lib/api';
import { DoorbellPauseControl } from '../doorbell-pause-control';
import type { RunAction } from './types';

const DEFAULT_QUIET = { start: '22:00', end: '08:00' };

/** Server-confirmed settings: inputs keep the typed value until the server accepts it. */
export function SettingsSection({ home, pending, run }: { home: HomeState; pending: string; run: RunAction }) {
  const [name, setName] = useState(home.name);
  const [quietStart, setQuietStart] = useState(home.quiet_start ?? DEFAULT_QUIET.start);
  const [quietEnd, setQuietEnd] = useState(home.quiet_end ?? DEFAULT_QUIET.end);
  const quietActive = Boolean(home.quiet_start && home.quiet_end);
  useEffect(() => { if (home.quiet_start) setQuietStart(home.quiet_start); if (home.quiet_end) setQuietEnd(home.quiet_end); }, [home.quiet_start, home.quiet_end]);
  return <section id="settings" className="section-block lower-section"><div className="section-title"><div><h2>Como en tu casa</h2><p>Los pequeños ajustes que hacen la diferencia.</p></div><Settings2 size={23} /></div>
    <form onSubmit={(event) => { event.preventDefault(); void run('name', () => api('settings', { name, enabled: home.enabled }), 'Nombre actualizado.', 'snapshot'); }}><label htmlFor="home-name">Nombre de tu casa</label><div className="inline-form"><input id="home-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={DOORBELL.nameMaxLength} /><button className="button outline" disabled={!!pending || !name.trim()}>{pending === 'name' ? 'Guardando…' : 'Guardar nombre'}</button></div></form>
    <DoorbellPauseControl enabled={home.enabled} pending={!!pending} onPause={() => run('pause', () => api('settings', { name: home.name, enabled: false }), 'Timbre pausado.', 'snapshot')} onResume={() => run('pause', () => api('settings', { name: home.name, enabled: true }), 'Timbre activado.', 'snapshot')} />
    <form className="quiet-hours" aria-labelledby="quiet-title" onSubmit={(event) => { event.preventDefault(); void run('quiet', () => api('quiet-hours', { start: quietStart, end: quietEnd }), `Horario de descanso guardado: de ${quietStart} a ${quietEnd}.`, 'snapshot'); }}>
      <div className="setting-row"><div><h3 id="quiet-title"><Moon size={15} aria-hidden="true" /> Horario de descanso</h3><p>{quietActive ? `Cada día de ${home.quiet_start} a ${home.quiet_end} el timbre no envía avisos.` : 'Elegí un horario para que el timbre no suene, por ejemplo de noche.'}</p></div></div>
      <div className="inline-form quiet-inputs"><div><label htmlFor="quiet-start">Desde</label><input id="quiet-start" type="time" required value={quietStart} onChange={(event) => setQuietStart(event.target.value)} /></div><div><label htmlFor="quiet-end">Hasta</label><input id="quiet-end" type="time" required value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} /></div>
        <button className="button outline" disabled={!!pending || quietStart === quietEnd}>{pending === 'quiet' ? 'Guardando…' : 'Guardar horario'}</button>
        {quietActive && <button type="button" className="text-button" disabled={!!pending} onClick={() => { void run('quiet-off', () => api('quiet-hours', { start: null, end: null }), 'Horario de descanso desactivado.', 'snapshot'); }}>{pending === 'quiet-off' ? 'Quitando…' : 'Quitar horario'}</button>}
      </div>
      {quietStart === quietEnd && <p className="field-hint" role="status">El inicio y el fin tienen que ser distintos.</p>}
    </form>
  </section>;
}
