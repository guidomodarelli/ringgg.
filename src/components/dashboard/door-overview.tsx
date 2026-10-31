import { ArrowUpRight, Bell, BellRing, CheckCheck, Smartphone } from 'lucide-react';
import type { DashboardSnapshot, Visit } from '@/types/doorbell';
import { VisitRow } from './visit-history';
import type { RunAction } from './types';

/** The note on the door drawing: it only says someone is at the door while a visit waits for an answer. */
const DOOR_NOTES = {
  ringing: { title: '¡Ding, dong!', detail: 'Alguien está en la puerta' },
  calm: { title: 'Todo tranquilo', detail: 'Nadie espera respuesta' },
} as const satisfies Record<'ringing' | 'calm', { title: string; detail: string }>;

/**
 * Overview block with the visits that still wait for an answer, and the same rows and quick replies as
 * the history, so the installed app opened from its icon shows them without going to «Timbrazos».
 */
export function DoorWaiting({ visits, pending, run }: { visits: Visit[]; pending: string; run: RunAction }) {
  if (visits.length === 0) return null;
  return <section className="door-waiting section-block" aria-labelledby="door-waiting-title"><div className="section-title"><div><h2 id="door-waiting-title">Hay alguien en la puerta</h2><p>Respondé desde acá y tu visita lo ve en su pantalla.</p></div><span className="count-badge">{visits.length}</span></div>
    <div className="visit-list">{visits.map((visit) => <VisitRow key={visit.id} visit={visit} open pending={pending} run={run} />)}</div>
  </section>;
}

export function DoorOverview({ url, data, someoneWaiting }: { url: string; data: DashboardSnapshot; someoneWaiting: boolean }) {
  const note = DOOR_NOTES[someoneWaiting ? 'ringing' : 'calm'];
  const NoteIcon = someoneWaiting ? BellRing : Bell;
  return <>
    <section className="door-overview" aria-labelledby="door-title"><div className="overview-copy"><span className="label-caps">TU TIMBRE DIGITAL</span><h2 id="door-title">Una puerta.<br />Muchas formas<br />de estar cerca.</h2><p>Un QR en la entrada.<br />Un aviso directo a tu celular.</p><a href={url} target="_blank" rel="noreferrer" className="button dark">Ver mi timbre <ArrowUpRight size={18} /></a></div>
      {/* Keyed by state, so the note arrives again when someone rings. */}
      <div className="door-art" aria-hidden="true"><div className="art-arch"><div className="art-door"><span className="door-panel" /><span className="door-knob" /></div><div className="art-doorbell"><Bell size={18} /></div></div><span className="art-ring ring-one" /><span className="art-ring ring-two" /><div className="art-note" key={note.title}><span className="note-bell"><NoteIcon size={20} /></span><span><strong>{note.title}</strong><small>{note.detail}</small></span></div><span className="art-star">✳</span></div>
    </section>
    <div className="quick-stats">
      <div><span className="stat-icon"><BellRing size={19} /></span><div><strong>{data.visits.length}</strong><span>Timbrazos recientes</span></div></div>
      <div><span className="stat-icon"><Smartphone size={19} /></span><div><strong>{data.devices.length}</strong><span>Dispositivos conectados</span></div></div>
      <div><span className="stat-icon"><CheckCheck size={19} /></span><div><strong>{data.visits.filter((visit) => visit.answered_at).length}</strong><span>Visitas atendidas</span></div></div>
    </div>
  </>;
}
