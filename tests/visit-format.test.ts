import { describe, expect, test } from 'vitest';
import { DOORBELL } from '../src/constants/doorbell';
import { TIME } from '../src/constants/time';
import { awaitsAnswer, answerSummary, replyOutcomeMessage, responseTime, visitFromUrl, visitsAwaitingAnswer } from '../src/lib/visit-format';

describe('formato del historial', () => {
  const created = '2026-10-29T20:00:00.000Z';

  test('resume quién respondió, qué respondió y cuánto tardó', () => {
    expect(answerSummary({ created_at: created, answered_at: '2026-10-29T20:00:12.000Z', reply: 'leave', answered_by: 'Guido' })).toBe('Guido · Pidió dejarlo en la puerta · respondió en 12 s');
    expect(responseTime({ created_at: created, answered_at: '2026-10-29T20:03:00.000Z' })).toBe('3 min');
  });

  test('las visitas viejas sin respuesta guardada se muestran como "Ya voy"', () => {
    expect(answerSummary({ created_at: created, answered_at: '2026-10-29T20:00:05.000Z', reply: null, answered_by: null })).toBe('Va en camino · respondió en 5 s');
    expect(answerSummary({ created_at: created, answered_at: null, reply: null, answered_by: null })).toBeNull();
  });

  test('confirma la respuesta guardada, no la pedida, si otro ya respondió', () => {
    expect(replyOutcomeMessage('leave', { reply: 'leave', answered_by: 'Guido' })).toBe('Tu visita ya ve: «Dejalo en la puerta».');
    expect(replyOutcomeMessage('leave', { reply: 'away', answered_by: 'Ana' })).toBe('Ana ya había respondido: tu visita ve «No están en casa».');
    expect(replyOutcomeMessage('coming', { reply: 'soon', answered_by: null })).toBe('Ya habían respondido: tu visita ve «Salen en 5 minutos».');
  });

  test('una visita espera respuesta solo sin responder y dentro de la ventana de respuesta', () => {
    const rangAt = new Date(created).getTime();
    const windowMs = DOORBELL.responseWindowSeconds * TIME.secondMs;
    const unanswered = { created_at: created, answered_at: null };
    expect(awaitsAnswer(unanswered, rangAt + windowMs - 1)).toBe(true);
    expect(awaitsAnswer(unanswered, rangAt + windowMs)).toBe(false);
    expect(awaitsAnswer({ created_at: created, answered_at: '2026-10-29T20:00:05.000Z' }, rangAt + TIME.secondMs)).toBe(false);
  });

  test('lista las visitas por responder en su orden, y ninguna sin reloj (render del servidor)', () => {
    const rangAt = new Date(created).getTime();
    const visits = [
      { id: 'nueva', created_at: '2026-10-29T20:01:00.000Z', answered_at: null },
      { id: 'atendida', created_at: '2026-10-29T20:00:30.000Z', answered_at: '2026-10-29T20:00:40.000Z' },
      { id: 'anterior', created_at: created, answered_at: null },
      { id: 'vencida', created_at: '2026-10-29T19:50:00.000Z', answered_at: null },
    ];
    expect(visitsAwaitingAnswer(visits, rangAt + 90 * TIME.secondMs).map((visit) => visit.id)).toEqual(['nueva', 'anterior']);
    expect(visitsAwaitingAnswer(visits, null)).toEqual([]);
  });

  test('solo un UUID en ?visit enfoca una visita', () => {
    const id = '0b3c3c1e-9d2a-4c55-9a44-0d1d8f4e6a10';
    expect(visitFromUrl(`/?view=history&visit=${id.toUpperCase()}`)).toBe(id);
    expect(visitFromUrl('/?visit=<script>')).toBe('');
    expect(visitFromUrl('/')).toBe('');
  });
});
