import { describe, expect, test } from 'vitest';
import { getDashboardView } from '../src/lib/dashboard-view';
describe('navegación del panel', () => {
  test('abre cada pantalla desde su URL y conserva enlaces anteriores', () => {
    expect(getDashboardView('?view=devices')).toBe('devices');
    expect(getDashboardView('', '#residents')).toBe('residents');
    expect(getDashboardView('?view=history', '#settings')).toBe('history');
  });
  test('si la dirección no identifica una pantalla vuelve al resumen', () => {
    expect(getDashboardView('?view=unknown')).toBe('overview');
    expect(getDashboardView('')).toBe('overview');
  });
});
