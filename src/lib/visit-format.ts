import { DOORBELL, VISIT_REPLIES, type VisitReply } from '@/constants/doorbell';
import type { DeliveryStatus, Visit } from '@/types/doorbell';

export function visitTime(value: string) {
  return new Intl.DateTimeFormat('es-AR', { timeZone: DOORBELL.timeZone, hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }).format(new Date(value));
}

export const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  registered: 'Registrando aviso',
  sent: 'Aviso enviado',
  partial: 'Aviso a algunos celulares',
  unavailable: 'Sin aviso a celulares',
};

/** "12 s" or "3 min": how long the home took to answer. */
export function responseTime(visit: Pick<Visit, 'created_at' | 'answered_at'>) {
  if (!visit.answered_at) return null;
  const seconds = Math.max(0, Math.round((new Date(visit.answered_at).getTime() - new Date(visit.created_at).getTime()) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

/** One line for the history: who answered, what they replied and how fast. Old rows have no reply. */
export function answerSummary(visit: Pick<Visit, 'created_at' | 'answered_at' | 'reply' | 'answered_by'>) {
  if (!visit.answered_at) return null;
  const reply = VISIT_REPLIES[visit.reply ?? 'coming'].history;
  return [visit.answered_by, reply, `respondió en ${responseTime(visit)}`].filter(Boolean).join(' · ');
}

/** Feedback after answering: only the first reply reaches the visitor, so confirm the stored one. */
export function replyOutcomeMessage(requested: VisitReply, visit: Pick<Visit, 'reply' | 'answered_by'> | null | undefined) {
  const stored = visit?.reply ?? requested;
  if (stored === requested) return `Tu visita ya ve: «${VISIT_REPLIES[requested].visitorTitle}».`;
  return `${visit?.answered_by ? `${visit.answered_by} ya había` : 'Ya habían'} respondido: tu visita ve «${VISIT_REPLIES[stored].visitorTitle}».`;
}

/** Only `?visit=<uuid>` deep links from notifications focus a visit. */
export function visitFromUrl(value: string) {
  const id = new URL(value, 'https://ringgg.invalid').searchParams.get('visit');
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : '';
}
