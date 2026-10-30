import { describe, expect, test } from 'vitest';
import { answerSummary, replyOutcomeMessage, responseTime, visitFromUrl } from '../src/lib/visit-format';

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

  test('solo un UUID en ?visit enfoca una visita', () => {
    const id = '0b3c3c1e-9d2a-4c55-9a44-0d1d8f4e6a10';
    expect(visitFromUrl(`/?view=history&visit=${id.toUpperCase()}`)).toBe(id);
    expect(visitFromUrl('/?visit=<script>')).toBe('');
    expect(visitFromUrl('/')).toBe('');
  });
});
