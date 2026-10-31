import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { ArrowUpRight, Bell, BellOff, BellRing, Check, MessageSquareText, MessagesSquare } from 'lucide-react';
import { CHAT } from '@/constants/chat';
import { VISIT_REPLIES, VISIT_REPLY_KEYS } from '@/constants/doorbell';
import { TIME } from '@/constants/time';
import type { RingRejection, Visit } from '@/types/doorbell';
import { api } from '@/lib/api';
import type { ChatAccess } from '@/lib/chat-protocol';
import { rejectedRingsSummary } from '@/lib/ring-rejections';
import { answerSummary, awaitsAnswer, DELIVERY_LABELS, receiptLabel, replyOutcomeMessage, visitTime } from '@/lib/visit-format';
import { VisitChat } from '../chat/visit-chat';
import type { RunAction } from './types';

/** Answered, still answerable with a quick reply, or past its response window. */
function VisitStatus({ visit, open, pending, run }: { visit: Visit; open: boolean; pending: string; run: RunAction }) {
  if (visit.answered_at) return <span className="visit-status"><Check size={14} /> Atendido</span>;
  if (!open) return <span className="visit-status muted">Sin respuesta</span>;
  return <div className="reply-actions" role="group" aria-label="Responder a la visita">{VISIT_REPLY_KEYS.map((reply) => {
    const key = `answer-${visit.id}-${reply}`;
    return <button key={reply} className={`button small ${reply === 'coming' ? 'primary' : 'outline'}`} disabled={Boolean(pending)} onClick={() => run(key, () => api('answer', { id: visit.id, reply }), (result) => replyOutcomeMessage(reply, result as Visit), 'visit')}>{pending === key ? 'Enviando…' : VISIT_REPLIES[reply].label}</button>;
  })}</div>;
}

/** When a visit's chat stops taking messages. */
function chatClosesAt(visit: Visit) {
  return new Date(visit.created_at).getTime() + CHAT.windowSeconds * TIME.secondMs;
}

/** A resident's side of a visit's chat: the visitor shows as «Visita» and the other residents by name. */
function ResidentChat({ visit, homeName, onScreen }: { visit: Visit; homeName: string; onScreen: boolean }) {
  const requestAccess = useCallback((signal: AbortSignal) => api<ChatAccess>(`chat/access?visit=${encodeURIComponent(visit.id)}`, undefined, signal), [visit.id]);
  return <VisitChat title="Chat con la visita" viewerRole="resident" homeName={homeName} requestAccess={requestAccess} knownClosesAt={chatClosesAt(visit)}
    emptyText="La visita todavía no escribió. Podés escribirle vos." closedText="El chat de esta visita terminó." onScreen={onScreen} />;
}

/**
 * The row's chat, when the deployment has one: whether it is open, how to toggle it and whether the
 * history is on screen. An open chat in a hidden section lets its socket go, so it does not keep the
 * Worker from notifying the residents' phones.
 */
interface VisitRowChat { expanded: boolean; onToggle: () => void; homeName: string; onScreen: boolean }

interface VisitRowProps { visit: Visit; open: boolean; pending: string; run: RunAction; focused?: boolean; ref?: Ref<HTMLElement>; chat?: VisitRowChat }

/**
 * One visit: what the visitor wrote, when, how the ring reached the home and its status, with the quick
 * replies while `open`. The history and the overview's «Hay alguien en la puerta» render the same row;
 * the history also passes `chat` so each visit offers its conversation.
 */
export function VisitRow({ visit, open, pending, run, focused = false, ref, chat }: VisitRowProps) {
  const summary = answerSummary(visit);
  const received = receiptLabel(visit.receipts);
  const chatId = `chat-${visit.id}`;
  return <article ref={ref} className={`visit-row ${open ? 'waiting' : ''} ${focused ? 'focused' : ''}`} aria-current={focused ? 'true' : undefined}>
    <div className="visit-icon"><BellRing size={20} /></div>
    <div className="visit-info"><h3>{visit.message || 'Alguien tocó el timbre'}</h3>
      <time dateTime={visit.created_at}>{visitTime(visit.created_at)}</time>
      <span className="visit-meta">{[DELIVERY_LABELS[visit.delivery], received, summary].filter(Boolean).join(' · ')}</span>
      {visit.note && <p className="visit-note"><MessageSquareText size={13} aria-hidden="true" /> <span><strong>Te dejó un mensaje:</strong> {visit.note}</span></p>}
      {chat && <button type="button" className="text-button visit-chat-toggle" aria-expanded={chat.expanded} aria-controls={chatId} onClick={chat.onToggle}>
        <MessagesSquare size={14} aria-hidden="true" /> {chat.expanded ? 'Ocultar chat' : 'Chat con la visita'}
      </button>}
    </div>
    <VisitStatus visit={visit} open={open} pending={pending} run={run} />
    {chat?.expanded && <div id={chatId} className="visit-chat-panel"><ResidentChat visit={visit} homeName={chat.homeName} onScreen={chat.onScreen} /></div>}
  </article>;
}

/** Today's rings that did not sound: one quiet line, only when there were some, so a home that asks for the visitor's location sees how many it turns away. */
function RejectedRings({ rejections }: { rejections: RingRejection[] }) {
  const summary = rejectedRingsSummary(rejections);
  if (!summary) return null;
  return <p className="history-rejections"><BellOff size={14} aria-hidden="true" /> <span>{summary}</span></p>;
}

/**
 * One chat open at a time. Opening the panel from a notification of a visit whose chat is still open
 * opens that chat too; `now` is `null` until the clock is read in the browser, so the server and the
 * first render agree.
 */
function useExpandedChat(focusTarget: string, visits: Visit[], now: number | null) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [autoOpened, setAutoOpened] = useState('');
  if (now !== null && focusTarget && focusTarget !== autoOpened) {
    setAutoOpened(focusTarget);
    const visit = visits.find((candidate) => candidate.id === focusTarget);
    if (visit && now < chatClosesAt(visit)) setExpanded(focusTarget);
  }
  return { expanded, toggle: (id: string) => setExpanded((current) => current === id ? null : id) };
}

interface VisitHistoryProps {
  visits: Visit[];
  /** Today's rejected rings by reason, from the same snapshot. */
  rejectedRings: RingRejection[];
  now: number | null;
  url: string;
  pending: string;
  run: RunAction;
  focusVisitId: string;
  /** This deployment has the chat: each visit offers its conversation. */
  chatEnabled?: boolean;
  homeName?: string;
  /** Whether the history is the dashboard section on screen; the others keep it mounted but hidden. */
  onScreen?: boolean;
}

/** History with quick replies on visits still inside the response window, and each visit's chat. */
export function VisitHistory({ visits, rejectedRings, now, url, pending, run, focusVisitId, chatEnabled = false, homeName = '', onScreen = true }: VisitHistoryProps) {
  const focused = useRef<HTMLElement | null>(null);
  const focusTarget = visits.some((visit) => visit.id === focusVisitId) ? focusVisitId : '';
  useEffect(() => { if (focusTarget) focused.current?.scrollIntoView({ block: 'center' }); }, [focusTarget]);
  const chats = useExpandedChat(chatEnabled ? focusTarget : '', visits, now);
  const chatFor = (visit: Visit): VisitRowChat | undefined => chatEnabled ? { expanded: chats.expanded === visit.id, onToggle: () => chats.toggle(visit.id), homeName, onScreen } : undefined;
  return <section id="history" className="history section-block"><div className="section-title"><div><h2>En tu puerta</h2><p>Los últimos timbrazos de tu casa.</p></div><span className="count-badge">{visits.length}</span></div>
    <RejectedRings rejections={rejectedRings} />
    {visits.length === 0 ? <div className="empty-visits"><div className="empty-icon"><Bell size={27} /></div><h3>Por ahora, todo tranquilo</h3><p>Cuando alguien toque tu timbre, lo vas a ver acá.</p><a href={url} target="_blank" rel="noreferrer">Probá tu primer timbrazo <ArrowUpRight size={15} /></a></div>
      : <div className="visit-list">{visits.map((visit) => <VisitRow key={visit.id} ref={visit.id === focusTarget ? focused : undefined} visit={visit} open={now !== null && awaitsAnswer(visit, now)} focused={visit.id === focusTarget} pending={pending} run={run} chat={chatFor(visit)} />)}</div>}
    <p className="section-footnote">Hasta 50 timbrazos · Historial de los últimos 30 días</p>
  </section>;
}
