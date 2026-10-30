import { useState } from 'react';
import { Moon, Settings2 } from 'lucide-react';
import { DOORBELL, PAUSE_OPTIONS } from '@/constants/doorbell';
import type { DashboardSnapshot, HomeState } from '@/types/doorbell';
import { api } from '@/lib/api';
import { pauseEnd } from '@/lib/pause';
import { DoorbellPauseControl } from '../doorbell-pause-control';
import { DeleteHomeSetting } from './delete-home-setting';
import type { RunAction } from './types';

const DEFAULT_QUIET = { start: '22:00', end: '08:00' };

/** Server-confirmed settings: inputs keep the typed value until the server accepts it. */
/** `homes` and `residents` count the resident's homes and this home's residents: deleting depends on both. */
export function SettingsSection({ home, homes, residents, pending, run }: { home: HomeState; homes: number; residents: number; pending: string; run: RunAction }) {
  const [name, setName] = useState(home.name);
  return <section id="settings" className="section-block lower-section"><div className="section-title"><div><h2>Como en tu casa</h2><p>Los pequeños ajustes que hacen la diferencia.</p></div><Settings2 size={23} /></div>
    <form onSubmit={(event) => { event.preventDefault(); void run('name', () => api<DashboardSnapshot>('settings', { home: home.id, name }), 'Nombre actualizado.', 'snapshot'); }}>
      <label htmlFor="home-name">Nombre de tu casa</label>
      <div className="inline-form"><input id="home-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={DOORBELL.nameMaxLength} /><button className="button outline" disabled={Boolean(pending) || !name.trim()}>{pending === 'name' ? 'Guardando…' : 'Guardar nombre'}</button></div>
    </form>
    <DoorbellPauseControl
      paused={home.paused}
      pausedUntil={pauseEnd(home)}
      pending={pending}
      onPause={(mode) => run(`pause-${mode}`, () => api<DashboardSnapshot>('pause', { home: home.id, mode }), PAUSE_OPTIONS.find((option) => option.mode === mode)?.feedback ?? 'Timbre pausado.', 'snapshot')}
      onResume={() => run('pause-resume', () => api<DashboardSnapshot>('pause', { home: home.id, mode: 'resume' }), 'Timbre activado.', 'snapshot')} />
    {/* A new confirmed range (saved here or by another resident) starts the form again from it. */}
    <QuietHoursForm key={`${home.quiet_start ?? ''}-${home.quiet_end ?? ''}`} home={home} pending={pending} run={run} />
    <DeleteHomeSetting homeId={home.id} homeName={home.name} residents={residents} homes={homes} />
  </section>;
}

function quietDescription(home: HomeState, editing: boolean) {
  if (home.quiet_start && home.quiet_end) return `Cada día de ${home.quiet_start} a ${home.quiet_end} el timbre no envía avisos.`;
  return editing ? 'Elegí desde qué hora y hasta qué hora el timbre no envía avisos.' : 'Desactivado: el timbre avisa a cualquier hora. Si querés, podés silenciarlo de noche.';
}

/** Quiet hours are optional: off by default, the range is only shown once the user chooses to set one. */
function QuietHoursForm({ home, pending, run }: { home: HomeState; pending: string; run: RunAction }) {
  const quietActive = Boolean(home.quiet_start && home.quiet_end);
  const [editing, setEditing] = useState(false);
  const [quietStart, setQuietStart] = useState(home.quiet_start ?? DEFAULT_QUIET.start);
  const [quietEnd, setQuietEnd] = useState(home.quiet_end ?? DEFAULT_QUIET.end);
  const busy = Boolean(pending);
  const showRange = quietActive || editing;
  const save = () => run('quiet', () => api('quiet-hours', { home: home.id, start: quietStart, end: quietEnd }), `Horario de descanso guardado: de ${quietStart} a ${quietEnd}.`, 'snapshot').then((ok) => { if (ok) setEditing(false); });
  const remove = () => run('quiet-off', () => api('quiet-hours', { home: home.id, start: null, end: null }), 'Horario de descanso desactivado.', 'snapshot').then((ok) => { if (ok) setEditing(false); });
  return <form className="quiet-hours" aria-labelledby="quiet-title" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <div className="setting-row"><div><h3 id="quiet-title"><Moon size={15} aria-hidden="true" /> Horario de descanso</h3><p>{quietDescription(home, editing)}</p></div>
      {!showRange && <button type="button" className="button outline" disabled={busy} onClick={() => setEditing(true)}>Configurar horario</button>}</div>
    {showRange && <><div id="quiet-range" className="inline-form quiet-inputs"><div><label htmlFor="quiet-start">Desde</label><input id="quiet-start" type="time" required value={quietStart} onChange={(event) => setQuietStart(event.target.value)} /></div><div><label htmlFor="quiet-end">Hasta</label><input id="quiet-end" type="time" required value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} /></div>
      <button className="button outline" disabled={busy || quietStart === quietEnd}>{pending === 'quiet' ? 'Guardando…' : 'Guardar horario'}</button>
      {quietActive
        ? <button type="button" className="text-button" disabled={busy} onClick={() => { void remove(); }}>{pending === 'quiet-off' ? 'Quitando…' : 'Quitar horario'}</button>
        : <button type="button" className="text-button" disabled={busy} onClick={() => setEditing(false)}>Cancelar</button>}
    </div>
    {quietStart === quietEnd && <p className="field-hint" role="status">El inicio y el fin tienen que ser distintos.</p>}</>}
  </form>;
}
