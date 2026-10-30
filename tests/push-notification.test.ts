import { describe, expect, test } from 'vitest';
import { dashboardUrl, notificationActions, parsePushData, receiptBody, renewalBody, replyFromAction } from '../src/lib/push-notification';
import { pushPayload } from '../src/server/push';

const ORIGIN = 'https://ringgg.example';

describe('notificaciones del service worker', () => {
  test('lee el payload que arma el servidor', () => {
    const visitId = crypto.randomUUID();
    // The payload travels as JSON: the server serializes it and the worker parses `event.data.json()`.
    const sent = JSON.stringify(pushPayload({ kind: 'ring', homeId: 7, title: 'Hay alguien en la puerta', body: 'Soy Juan', visitId, answerable: true }));
    const data = parsePushData(JSON.parse(sent));
    expect(data).toMatchObject({ kind: 'ring', title: 'Hay alguien en la puerta', body: 'Soy Juan', tag: visitId, visitId, url: `/?home=7&view=history&visit=${visitId}` });
    expect(notificationActions(data)).toEqual([{ action: 'reply:coming', title: 'Ya voy' }, { action: 'reply:leave', title: 'Dejalo en la puerta' }]);
  });

  test('un payload roto igual muestra un aviso seguro y sin acciones', () => {
    for (const raw of [null, 'texto', 42, { title: 7, replies: 'no' }]) {
      const data = parsePushData(raw);
      expect(data.title).toBe('Hay alguien en la puerta');
      expect(notificationActions(data)).toEqual([]);
    }
  });

  test('solo ofrece respuestas que el servidor acepta, como mucho dos y solo para una visita', () => {
    const replies = [{ reply: 'coming', title: 'Ya voy' }, { reply: 'hack', title: 'Otra' }, { reply: 'soon', title: 'En 5' }, { reply: 'away', title: 'No estoy' }];
    expect(notificationActions(parsePushData({ visitId: 'visit', replies })).map((item) => item.action)).toEqual(['reply:coming', 'reply:soon']);
    expect(notificationActions(parsePushData({ replies }))).toEqual([]);
    expect(replyFromAction('reply:leave')).toBe('leave');
    expect(replyFromAction('')).toBeNull();
  });

  test('la notificación solo abre el panel de este origen', () => {
    expect(dashboardUrl('/?home=7&view=history&visit=abc', ORIGIN)).toBe('/?home=7&view=history&visit=abc');
    expect(dashboardUrl('https://evil.example/?view=history', ORIGIN)).toBe('/');
    expect(dashboardUrl('/t/token', ORIGIN)).toBe('/');
    expect(dashboardUrl(undefined, ORIGIN)).toBe('/');
  });

  test('el recibo y la renovación llevan solo lo que el servidor necesita', () => {
    expect(receiptBody('https://fcm.googleapis.com/x', undefined)).toEqual({ endpoint: 'https://fcm.googleapis.com/x', visitId: null });
    expect(renewalBody({ endpoint: 'new' }, 'old')).toEqual({ subscription: { endpoint: 'new' }, previousEndpoint: 'old' });
  });
});
