import { describe, expect, test } from 'vitest';
import { deviceNameProblem, freeDeviceName, isGenericDeviceName, suggestedDeviceName } from '../src/lib/device-name';
import { isPaused, pauseEnd, pauseEndLabel } from '../src/lib/pause';
import { deviceHealth } from '../src/lib/device-health';
import { receiptLabel } from '../src/lib/visit-format';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

describe('nombre sugerido del dispositivo', () => {
  test('combina la plataforma con el primer nombre del residente', () => {
    expect(suggestedDeviceName(IPHONE, 'Guido Modarelli')).toBe('iPhone de Guido');
    expect(suggestedDeviceName(ANDROID, 'Ana')).toBe('Android de Ana');
    expect(suggestedDeviceName(WINDOWS, '  ')).toBe('Windows');
    expect(suggestedDeviceName('desconocido', 'Ana')).toBe('Celular de Ana');
  });

  test('la sugerencia no repite el nombre de otro celular de la casa', () => {
    expect(freeDeviceName(IPHONE, 'Guido', ['Android de Ana'])).toBe('iPhone de Guido');
    expect(freeDeviceName(IPHONE, 'Guido', ['iphone de guído'])).toBe('iPhone de Guido 2');
  });

  test('«Mi celular», «Celular» y sus copias numeradas no identifican a ningún celular', () => {
    for (const name of ['Mi celular', 'celular', ' MI  CELULAR 2 ', 'Celular 10']) expect(isGenericDeviceName(name)).toBe(true);
    for (const name of ['Celular de Ana', 'Mi celular nuevo', 'iPhone']) expect(isGenericDeviceName(name)).toBe(false);
  });

  test('el nombre es obligatorio, no genérico y propio de la casa', () => {
    expect(deviceNameProblem('   ', [])).toBe('Escribí un nombre para este dispositivo.');
    expect(deviceNameProblem('Mi celular', [])).toContain('Elegí un nombre que lo distinga');
    expect(deviceNameProblem(' ANDROID de ana ', ['Android de Ana'])).toBe('Ya hay un celular llamado «ANDROID de ana» en esta casa. Elegí otro nombre.');
    expect(deviceNameProblem('iPhone de Guido', ['Android de Ana'])).toBe('');
  });
});

describe('estado de los avisos de cada celular', () => {
  const empty = { last_success_at: null, last_failure_at: null, last_failure_status: null, last_received_at: null };

  test('el evento más reciente decide qué se dice del celular', () => {
    expect(deviceHealth(empty)).toEqual({ tone: 'idle', text: 'Todavía no recibió avisos. Enviale una prueba.' });
    expect(deviceHealth({ ...empty, last_success_at: '2026-10-30T18:00:00Z' })).toMatchObject({ tone: 'ok', text: expect.stringMatching(/^Último aviso enviado · /) });
    expect(deviceHealth({ ...empty, last_success_at: '2026-10-30T18:00:00Z', last_received_at: '2026-10-30T18:00:02Z' })).toMatchObject({ tone: 'ok', text: expect.stringMatching(/^Recibió el último aviso · /) });
    const failing = deviceHealth({ ...empty, last_success_at: '2026-10-30T17:00:00Z', last_failure_at: '2026-10-30T18:00:00Z', last_failure_status: 403 });
    expect(failing.tone).toBe('warning');
    expect(failing.text).toContain('(código 403)');
    expect(deviceHealth({ ...empty, last_failure_at: '2026-10-30T17:00:00Z', last_failure_status: 500, last_success_at: '2026-10-30T18:00:00Z' }).tone).toBe('ok');
  });

  test('el historial cuenta los celulares que confirmaron el timbrazo', () => {
    expect(receiptLabel(0)).toBeNull();
    expect(receiptLabel(1)).toBe('Lo recibió 1 celular');
    expect(receiptLabel(3)).toBe('Lo recibieron 3 celulares');
  });
});

describe('pausa', () => {
  // 15:00 in Buenos Aires (UTC-3).
  const now = new Date('2026-10-30T18:00:00Z');

  test('distingue la pausa indefinida, la programada y la vencida', () => {
    expect(isPaused({ enabled: false, paused_until: null }, now)).toBe(true);
    expect(isPaused({ enabled: true, paused_until: '2026-10-30T19:00:00Z' }, now)).toBe(true);
    expect(isPaused({ enabled: true, paused_until: '2026-10-30T17:00:00Z' }, now)).toBe(false);
    expect(pauseEnd({ enabled: true, paused_until: '2026-10-30T19:00:00Z' }, now)).toBe('2026-10-30T19:00:00Z');
    expect(pauseEnd({ enabled: false, paused_until: null }, now)).toBeNull();
  });

  test('dice hasta cuándo en la hora de la casa', () => {
    expect(pauseEndLabel('2026-10-30T19:00:00Z', now)).toBe('hasta las 16:00');
    expect(pauseEndLabel('2026-10-31T11:00:00Z', now)).toBe('hasta mañana a las 08:00');
    expect(pauseEndLabel('2026-11-03T11:00:00Z', now)).toMatch(/^hasta el 3 nov\.? a las 08:00$/);
  });
});
