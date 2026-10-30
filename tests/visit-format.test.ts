import { describe, expect, test } from 'vitest';
import { answerSummary, responseTime, visitFromUrl } from '../src/lib/visit-format';

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

  test('solo un UUID en ?visit enfoca una visita', () => {
    const id = '0b3c3c1e-9d2a-4c55-9a44-0d1d8f4e6a10';
    expect(visitFromUrl(`/?view=history&visit=${id.toUpperCase()}`)).toBe(id);
    expect(visitFromUrl('/?visit=<script>')).toBe('');
    expect(visitFromUrl('/')).toBe('');
  });
});
