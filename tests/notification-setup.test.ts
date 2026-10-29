import { describe, expect, test } from 'vitest';
import { needsNotificationSetup } from '../src/lib/notification-setup';

describe('aviso inicial para activar el timbre', () => {
  test.each([
    [true, 'default', false, false, true],
    [true, 'denied', false, false, true],
    [true, 'granted', false, false, true],
    [true, 'granted', true, false, true],
    [true, 'granted', true, true, false],
    [false, 'unsupported', false, false, true],
  ] as const)('soporte %s, permiso %s, suscripción %s y registro %s muestran aviso: %s', (supported, permission, subscribed, registered, expected) => {
    expect(needsNotificationSetup(supported, permission, subscribed, registered)).toBe(expected);
  });
});
