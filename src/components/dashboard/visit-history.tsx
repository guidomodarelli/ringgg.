import { useEffect, useRef } from 'react';
import { ArrowUpRight, Bell, BellRing, Check, MessageSquareText } from 'lucide-react';
import { DOORBELL, VISIT_REPLIES, VISIT_REPLY_KEYS } from '@/constants/doorbell';
import type { Visit } from '@/types/doorbell';
import { api } from '@/lib/api';
import { answerSummary, DELIVERY_LABELS, replyOutcomeMessage, visitTime } from '@/lib/visit-format';
import type { RunAction } from './types';

/** History with quick replies on visits still inside the response window. */
export function VisitHistory({ visits, now, url, pending, run, focusVisitId }: { visits: Visit[]; now: number | null; url: string; pending: string; run: RunAction; focusVisitId: string }) {
  const focused = useRef<HTMLElement | null>(null);
  const focusTarget = visits.some((visit) => visit.id === focusVisitId) ? focusVisitId : '';
  useEffect(() => { if (focusTarget) focused.current?.scrollIntoView({ block: 'center' }); }, [focusTarget]);
  const waiting = (visit: Visit) => !visit.answered_at && now !== null && now - new Date(visit.created_at).getTime() < DOORBELL.responseWindowSeconds * 1000;
  return <section id="history" className="history section-block"><div className="section-title"><div><h2>En tu puerta</h2><p>Los últimos timbrazos de tu casa.</p></div><span className="count-badge">{visits.length}</span></div>
    {visits.length === 0 ? <div className="empty-visits"><div className="empty-icon"><Bell size={27} /></div><h3>Por ahora, todo tranquilo</h3><p>Cuando alguien toque tu timbre, lo vas a ver acá.</p><a href={url} target="_blank" rel="noreferrer">Probá tu primer timbrazo <ArrowUpRight size={15} /></a></div>
      : <div className="visit-list">{visits.map((visit) => {
        const open = waiting(visit);
        const summary = answerSummary(visit);
        return <article key={visit.id} ref={visit.id === focusTarget ? focused : undefined} className={`visit-row ${open ? 'waiting' : ''} ${visit.id === focusTarget ? 'focused' : ''}`} aria-current={visit.id === focusTarget ? 'true' : undefined}>
          <div className="visit-icon"><BellRing size={20} /></div>
          <div className="visit-info"><h3>{visit.message || 'Alguien tocó el timbre'}</h3>
            <time dateTime={visit.created_at}>{visitTime(visit.created_at)}</time>
            <span className="visit-meta">{DELIVERY_LABELS[visit.delivery]}{summary ? ` · ${summary}` : ''}</span>
            {visit.note && <p className="visit-note"><MessageSquareText size={13} aria-hidden="true" /> <span><strong>Te dejó un mensaje:</strong> {visit.note}</span></p>}
          </div>
          {visit.answered_at ? <span className="visit-status"><Check size={14} /> Atendido</span>
            : open ? <div className="reply-actions" role="group" aria-label="Responder a la visita">{VISIT_REPLY_KEYS.map((reply) => {
              const key = `answer-${visit.id}-${reply}`;
              return <button key={reply} className={`button small ${reply === 'coming' ? 'primary' : 'outline'}`} disabled={!!pending} onClick={() => run(key, () => api('answer', { id: visit.id, reply }), (result) => replyOutcomeMessage(reply, result as Visit))}>{pending === key ? 'Enviando…' : VISIT_REPLIES[reply].label}</button>;
            })}</div>
            : <span className="visit-status muted">Sin respuesta</span>}
        </article>;
      })}</div>}
    <p className="section-footnote">Hasta 50 timbrazos · Historial de los últimos 30 días</p>
  </section>;
}
