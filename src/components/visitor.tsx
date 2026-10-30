'use client';
import { useEffect, useRef, useState } from 'react';
import { BellRing, Check, ShieldCheck, ArrowUpRight, MessageSquareText } from 'lucide-react';
import { Brand } from './brand';
import { DOORBELL, VISIT_REPLIES } from '@/constants/doorbell';
import type { PublicHome, PublicVisit } from '@/types/doorbell';
import { api } from '@/lib/api';

function waitingDetail(visit: PublicVisit) {
  if (visit.delivery === 'sent' || visit.delivery === 'partial') return 'Enviamos el aviso. Esperá acá para ver si responden.';
  if (visit.delivery === 'registered') return 'Registramos tu timbrazo. Estamos consultando el estado del aviso.';
  return 'Tu timbrazo quedó registrado, pero no pudimos enviar una notificación. Puede que no haya celulares conectados.';
}

/** Visitors can leave one note when nobody answered or the residents said they are away. */
function NoteForm({ token, visit, onSaved }: { token: string; visit: PublicVisit; onSaved: (visit: PublicVisit) => void }) {
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  async function send() {
    if (sending.current || !note.trim()) return; sending.current = true; setPending(true); setError('');
    // Retrying is safe: the server keeps the first note and never notifies twice.
    try { onSaved(await api<PublicVisit>(`door/${token}/visits/${visit.id}/note`, { note })); }
    catch (error) { setError(error instanceof Error ? error.message : 'No pudimos enviar tu mensaje. Reintentá.'); }
    finally { setPending(false); sending.current = false; }
  }
  return <form className="visitor-note" onSubmit={(event) => { event.preventDefault(); void send(); }}>
    <label htmlFor="visitor-note">Dejales un mensaje <span>Podés sumar tu nombre o un teléfono</span></label>
    <textarea id="visitor-note" rows={3} placeholder="Pasé a dejar el paquete, llamame al…" value={note} disabled={pending} maxLength={DOORBELL.noteMaxLength} onChange={(event) => setNote(event.target.value)} />
    <div className="message-count">{note.length}/{DOORBELL.noteMaxLength}</div>
    <button className="button primary full" disabled={pending || !note.trim()}><MessageSquareText size={18} />{pending ? 'Enviando…' : 'Dejar mensaje'}</button>
    {error && <p role="alert" className="feedback error">{error}</p>}
  </form>;
}

export function Visitor({ home, token }: { home: PublicHome; token: string }) {
  const [message, setMessage] = useState('');
  const [visit, setVisit] = useState<PublicVisit | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const operationId = useRef('');
  const sending = useRef(false);
  useEffect(() => {
    if (!visit || visit.answered_at || expired) return;
    const controller = new AbortController(); let stopped = false; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const fresh = await api<PublicVisit>(`door/${token}/visits/${visit!.id}`, undefined, controller.signal);
        if (!stopped) { setVisit(fresh); setError(''); }
        if (fresh.answered_at) return;
        // Read the final server state even when a suspended tab resumes after the deadline.
        if (Date.now() - new Date(fresh.created_at).getTime() > DOORBELL.responseWindowSeconds * 1000) { if (!stopped) setExpired(true); return; }
      }
      catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Revisá tu conexión para ver la respuesta.'); }
      if (!stopped) timer = setTimeout(poll, DOORBELL.pollIntervalMs);
    }
    timer = setTimeout(poll, DOORBELL.pollIntervalMs);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [visit?.id, visit?.answered_at, token, expired]);

  async function ring() {
    if (sending.current) return; sending.current = true; setPending(true); setError('');
    operationId.current ||= crypto.randomUUID();
    try { const result = await api<PublicVisit>(`door/${token}`, { id: operationId.current, message }); setVisit(result); }
    catch (error) { setError(error instanceof Error ? error.message : 'No pudimos conectar. Reintentá; no se duplicará tu timbrazo.'); }
    finally { setPending(false); sending.current = false; }
  }

  const reply = visit?.answered_at ? VISIT_REPLIES[visit.reply ?? 'coming'] : null;
  const canLeaveNote = Boolean(visit && !visit.noted && (expired || visit.reply === 'away'));
  const result = !visit ? null : <div className="visitor-result" aria-live="polite">
    <h2>{reply ? reply.visitorTitle : expired ? 'Todavía no respondieron' : '¡Ding, dong!'}</h2>
    <p>{reply ? reply.visitorDetail : expired ? 'Tu visita quedó registrada. Puede que no estén disponibles.' : waitingDetail(visit)}</p>
    {!expired && !visit.answered_at && <span className="waiting-indicator"><i /> Esperando respuesta</span>}
    {visit.noted && <p className="feedback success" role="status"><Check size={17} /> Le dejamos tu mensaje.</p>}
    {canLeaveNote && <NoteForm token={token} visit={visit} onSaved={setVisit} />}
    {expired && <button className="button outline full" onClick={() => { setVisit(null); setExpired(false); operationId.current = ''; }}>Volver a tocar</button>}
  </div>;

  const unavailable = !home.enabled
    ? <div className="visitor-result"><h2>El timbre está en pausa</h2><p>En este momento no se pueden enviar avisos. Intentá más tarde.</p></div>
    : home.quiet ? <div className="visitor-result"><h2>Es horario de descanso</h2><p>{home.quietUntil ? `El timbre vuelve a sonar a las ${home.quietUntil}.` : 'En este momento no se pueden enviar avisos.'} Intentá más tarde.</p></div>
      : null;

  return <main className="visitor-page"><Brand /><div className="visitor-content"><span className="eyebrow">ESTÁS EN LA PUERTA DE</span><h1>{home.name}<span>.</span></h1><p className="visitor-intro">Un toque y saben que llegaste.</p>
    <div className={`visitor-bell ${visit ? 'rang' : ''}`}>{visit?.answered_at && visit.reply !== 'away' ? <Check size={62} strokeWidth={1.5} /> : <BellRing size={62} strokeWidth={1.5} />}</div>
    {result ?? unavailable ?? <form onSubmit={(event) => { event.preventDefault(); void ring(); }}><label htmlFor="visitor-message">¿Querés decir quién sos? <span>Opcional</span></label><textarea id="visitor-message" rows={3} placeholder="Hola, soy del delivery…" value={message} disabled={pending} maxLength={DOORBELL.messageMaxLength} onChange={(event) => setMessage(event.target.value)} /><div className="message-count">{message.length}/{DOORBELL.messageMaxLength}</div><button className="button primary ring-button" disabled={pending}><BellRing size={21} />{pending ? 'Tocando timbre…' : 'Tocar timbre'}</button></form>}
    {error && <p role="alert" className="feedback error">{error}</p>}
    <div className="visitor-privacy"><ShieldCheck size={16} /> No compartimos tus datos con el residente.</div></div><footer>Un timbre de <a href="/">ringgg. <ArrowUpRight size={13} /></a></footer></main>;
}
