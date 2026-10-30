'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BellRing, Check, ShieldCheck, ArrowUpRight, MessageSquareText, MapPin } from 'lucide-react';
import { Brand } from './brand';
import { DOORBELL, VISIT_REPLIES } from '@/constants/doorbell';
import { VISITOR_POLLING } from '@/constants/polling';
import { TIME } from '@/constants/time';
import { pauseEndLabel } from '@/lib/pause';
import type { PublicHome, PublicVisit } from '@/types/doorbell';
import { api } from '@/lib/api';
import { currentPosition, locationFailure } from '@/lib/browser-location';
import type { Position } from '@/lib/geo';
import { LocationGate, useLocationGate } from './visitor-location-gate';

function waitingDetail(visit: PublicVisit) {
  if (visit.delivery === 'sent' || visit.delivery === 'partial') return 'Enviamos el aviso. Esperá acá para ver si responden.';
  if (visit.delivery === 'registered') return 'Registramos tu timbrazo. Estamos consultando el estado del aviso.';
  return 'Tu timbrazo quedó registrado, pero no pudimos enviar una notificación. Puede que no haya celulares conectados.';
}

/** Visitors can leave one note when nobody answered or the residents said they are away. */
function NoteForm({ token, visit, onSaved, onPendingChange }: { token: string; visit: PublicVisit; onSaved: (visit: PublicVisit) => void; onPendingChange: (pending: boolean) => void }) {
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  async function send() {
    if (sending.current || !note.trim()) return; sending.current = true; setPending(true); onPendingChange(true); setError('');
    // Retrying is safe: the server keeps the first note and never notifies twice.
    try { onSaved(await api<PublicVisit>(`door/${token}/visits/${visit.id}/note`, { note })); }
    catch (error) { setError(error instanceof Error ? error.message : 'No pudimos enviar tu mensaje. Reintentá.'); }
    finally { setPending(false); onPendingChange(false); sending.current = false; }
  }
  return <form className="visitor-note" onSubmit={(event) => { event.preventDefault(); void send(); }}>
    <label htmlFor="visitor-note">Dejales un mensaje <span>Podés sumar tu nombre o un teléfono</span></label>
    <textarea id="visitor-note" rows={3} placeholder="Pasé a dejar el paquete, llamame al…" value={note} disabled={pending} maxLength={DOORBELL.noteMaxLength} onChange={(event) => setNote(event.target.value)} />
    <div className="message-count">{note.length}/{DOORBELL.noteMaxLength}</div>
    <button className="button primary full" disabled={pending || !note.trim()}><MessageSquareText size={18} />{pending ? 'Enviando…' : 'Dejar mensaje'}</button>
    {error && <p role="alert" className="feedback error">{error}</p>}
  </form>;
}

interface AnswerPollingOptions {
  token: string;
  visit: PublicVisit | null;
  expired: boolean;
  setVisit: (visit: PublicVisit) => void;
  setExpired: (expired: boolean) => void;
  setError: (message: string) => void;
}

/** Waits for an answer while the visit can still get one, reading the server's final state at the deadline. */
function useAnswerPolling({ token, visit, expired, setVisit, setExpired, setError }: AnswerPollingOptions) {
  const visitId = visit?.id;
  const answered = Boolean(visit?.answered_at);
  useEffect(() => {
    if (!visitId || answered || expired) return;
    const controller = new AbortController(); let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const fresh = await api<PublicVisit>(`door/${token}/visits/${visitId}`, undefined, controller.signal);
        if (!stopped) { setVisit(fresh); setError(''); }
        if (fresh.answered_at) return;
        // Read the final server state even when a suspended tab resumes after the deadline.
        if (Date.now() - new Date(fresh.created_at).getTime() > DOORBELL.responseWindowSeconds * TIME.secondMs) { if (!stopped) setExpired(true); return; }
      }
      catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Revisá tu conexión para ver la respuesta.'); }
      if (!stopped) timer = setTimeout(() => { void poll(); }, VISITOR_POLLING.answerMs);
    }
    timer = setTimeout(() => { void poll(); }, VISITOR_POLLING.answerMs);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [visitId, answered, token, expired, setVisit, setExpired, setError]);
}

/** Availability is rendered by the server once; it is checked again so the form appears when quiet hours end or the bell resumes. */
function useAvailabilityCheck({ token, waiting, setHome }: { token: string; waiting: boolean; setHome: (home: PublicHome) => void }) {
  useEffect(() => {
    if (!waiting) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      try { const fresh = await api<PublicHome>(`door/${token}`, undefined, controller.signal); if (!controller.signal.aborted) setHome(fresh); }
      catch { /* Keep the last known state; the next check retries. */ }
      if (!controller.signal.aborted) timer = setTimeout(() => { void refresh(); }, VISITOR_POLLING.availabilityMs);
    }
    timer = setTimeout(() => { void refresh(); }, VISITOR_POLLING.availabilityMs);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [waiting, token, setHome]);
}

/** Why the bell cannot ring right now, or `null` while it is available. */
function UnavailableNotice({ home }: { home: PublicHome }) {
  if (home.paused) return <div className="visitor-result"><h2>El timbre está en pausa</h2><p>{home.pausedUntil ? `No se pueden enviar avisos ${pauseEndLabel(home.pausedUntil)}.` : 'En este momento no se pueden enviar avisos.'} Intentá más tarde.</p></div>;
  if (home.quiet) return <div className="visitor-result"><h2>Es horario de descanso</h2><p>{home.quietUntil ? `El timbre vuelve a sonar a las ${home.quietUntil}.` : 'En este momento no se pueden enviar avisos.'} Intentá más tarde.</p></div>;
  return null;
}

interface VisitResultProps {
  token: string;
  visit: PublicVisit;
  expired: boolean;
  notePending: boolean;
  onNotePendingChange: (pending: boolean) => void;
  onNoteSaved: (visit: PublicVisit) => void;
  onRingAgain: () => void;
}

/** The ring's progress: waiting, the residents' reply, or no answer in time, with the note form when it applies. */
function VisitResult({ token, visit, expired, notePending, onNotePendingChange, onNoteSaved, onRingAgain }: VisitResultProps) {
  const reply = visit.answered_at ? VISIT_REPLIES[visit.reply ?? 'coming'] : null;
  const canLeaveNote = !visit.noted && (expired || visit.reply === 'away');
  let title = '¡Ding, dong!';
  let detail = waitingDetail(visit);
  if (reply) { title = reply.visitorTitle; detail = reply.visitorDetail; }
  else if (expired) { title = 'Todavía no respondieron'; detail = 'Tu visita quedó registrada. Puede que no estén disponibles.'; }
  return <div className="visitor-result" aria-live="polite">
    <h2>{title}</h2>
    <p>{detail}</p>
    {!expired && !visit.answered_at && <span className="waiting-indicator"><i /> Esperando respuesta</span>}
    {visit.noted && <p className="feedback success" role="status"><Check size={17} /> Le dejamos tu mensaje.</p>}
    {canLeaveNote && <NoteForm token={token} visit={visit} onPendingChange={onNotePendingChange} onSaved={onNoteSaved} />}
    {expired && <button className="button outline full" disabled={notePending} onClick={onRingAgain}>Volver a tocar</button>}
  </div>;
}

export function Visitor({ home: initialHome, token }: { home: PublicHome; token: string }) {
  const [home, setHome] = useState(initialHome);
  const [message, setMessage] = useState('');
  const [visit, setVisit] = useState<PublicVisit | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [notePending, setNotePending] = useState(false);
  const operationId = useRef('');
  const sending = useRef(false);
  useAnswerPolling({ token, visit, expired, setVisit, setExpired, setError });
  const available = !home.paused && !home.quiet;
  useAvailabilityCheck({ token, waiting: visit === null && !available, setHome });
  // A home that only rings from its door needs this visitor's location before anything else.
  const location = useLocationGate(home.nearbyOnly && available && visit === null);

  async function ring() {
    if (sending.current) return; sending.current = true; setPending(true); setError('');
    operationId.current ||= crypto.randomUUID();
    // A fresh reading for every ring: it is compared on the server and never stored.
    let position: Position | null = null;
    if (home.nearbyOnly) {
      try { position = await currentPosition(); }
      catch (error) { location.recordFailure(locationFailure(error)); setPending(false); sending.current = false; return; }
    }
    try { const result = await api<PublicVisit>(`door/${token}`, { id: operationId.current, message, position }); setVisit(result); }
    catch (error) { setError(error instanceof Error ? error.message : 'No pudimos conectar. Reintentá; no se duplicará tu timbrazo.'); }
    finally { setPending(false); sending.current = false; }
  }
  function ringAgain() { setVisit(null); setExpired(false); operationId.current = ''; }

  const result = visit && <VisitResult token={token} visit={visit} expired={expired} notePending={notePending} onNotePendingChange={setNotePending} onNoteSaved={(saved) => setVisit((current) => current?.id === saved.id ? saved : current)} onRingAgain={ringAgain} />;
  const ringForm = <form onSubmit={(event) => { event.preventDefault(); void ring(); }}><label htmlFor="visitor-message">¿Querés decir quién sos? <span>Opcional</span></label><textarea id="visitor-message" rows={3} placeholder="Hola, soy del delivery…" value={message} disabled={pending} maxLength={DOORBELL.messageMaxLength} onChange={(event) => setMessage(event.target.value)} /><div className="message-count">{message.length}/{DOORBELL.messageMaxLength}</div><button className="button primary ring-button" disabled={pending}><BellRing size={21} />{pending ? 'Tocando timbre…' : 'Tocar timbre'}</button>{home.nearbyOnly && <p className="visitor-location-note"><MapPin size={14} /> Usamos tu ubicación solo para confirmar que estás en la puerta. No la guardamos.</p>}</form>;
  const gated = location.state !== 'ready';
  const doorbell = gated
    ? <p className="waiting-indicator" role="status"><i /> {location.state === 'checking' ? 'Confirmando que estés en la puerta…' : 'Necesitamos tu ubicación para tocar el timbre.'}</p>
    : ringForm;

  return <main className="visitor-page"><Brand /><div className="visitor-content"><span className="eyebrow">ESTÁS EN LA PUERTA DE</span><h1>{home.name}<span>.</span></h1><p className="visitor-intro">Un toque y saben que llegaste.</p>
    <div className={`visitor-bell ${visit ? 'rang' : ''}`}>{visit?.answered_at && visit.reply !== 'away' ? <Check size={62} strokeWidth={1.5} /> : <BellRing size={62} strokeWidth={1.5} />}</div>
    {result ?? (available ? doorbell : <UnavailableNotice home={home} />)}
    {!result && available && gated && location.state !== 'checking' && <LocationGate homeName={home.name} state={location.state} failure={location.failure} onRequest={location.request} />}
    {error && <p role="alert" className="feedback error">{error}</p>}
    <div className="visitor-privacy"><ShieldCheck size={16} /> No compartimos tus datos con el residente.</div></div><footer>Un timbre de <Link href="/">ringgg. <ArrowUpRight size={13} /></Link></footer></main>;
}
