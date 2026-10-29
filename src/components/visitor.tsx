'use client';
import { useEffect, useRef, useState } from 'react';
import { BellRing, Check, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { Brand } from './brand';
import { DOORBELL } from '@/constants/doorbell';
import type { PublicVisit } from '@/types/doorbell';
import { api } from '@/lib/api';

export function Visitor({ home, token }: { home: { name: string; enabled: boolean }; token: string }) {
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

  return <main className="visitor-page"><Brand /><div className="visitor-content"><span className="eyebrow">ESTÁS EN LA PUERTA DE</span><h1>{home.name}<span>.</span></h1><p className="visitor-intro">Un toque y saben que llegaste.</p><div className={`visitor-bell ${visit ? 'rang' : ''}`}>{visit?.answered_at ? <Check size={62} strokeWidth={1.5} /> : <BellRing size={62} strokeWidth={1.5} />}</div>{!home.enabled && !visit ? <div className="visitor-result"><h2>El timbre está en pausa</h2><p>En este momento no se pueden enviar avisos. Intentá más tarde.</p></div> : !visit ? <form onSubmit={(event) => { event.preventDefault(); void ring(); }}><label htmlFor="visitor-message">¿Querés decir quién sos? <span>Opcional</span></label><textarea id="visitor-message" rows={3} placeholder="Hola, soy del delivery…" value={message} disabled={pending} maxLength={DOORBELL.messageMaxLength} onChange={(event) => setMessage(event.target.value)} /><div className="message-count">{message.length}/{DOORBELL.messageMaxLength}</div><button className="button primary ring-button" disabled={pending}><BellRing size={21} />{pending ? 'Tocando timbre…' : 'Tocar timbre'}</button></form> : <div className="visitor-result" aria-live="polite"><h2>{visit.answered_at ? '¡Ya van!' : expired ? 'Todavía no respondieron' : '¡Ding, dong!'}</h2><p>{visit.answered_at ? 'Recibieron tu aviso y están en camino. Esperá un momento.' : expired ? 'Tu visita quedó registrada. Puede que no estén disponibles.' : visit.delivery === 'sent' || visit.delivery === 'partial' ? 'Enviamos el aviso. Esperá acá para ver si responden.' : visit.delivery === 'registered' ? 'Registramos tu timbrazo. Estamos consultando el estado del aviso.' : 'Tu timbrazo quedó registrado, pero no pudimos enviar una notificación. Puede que no haya celulares conectados.'}</p>{!expired && !visit.answered_at && <span className="waiting-indicator"><i /> Esperando respuesta</span>}{expired && <button className="button outline full" onClick={() => { setVisit(null); setExpired(false); operationId.current = ''; }}>Volver a tocar</button>}</div>}{error && <p role="alert" className="feedback error">{error}</p>}<div className="visitor-privacy"><ShieldCheck size={16} /> No compartimos tus datos con el residente.</div></div><footer>Un timbre de <a href="/">ringgg. <ArrowUpRight size={13} /></a></footer></main>;
}
