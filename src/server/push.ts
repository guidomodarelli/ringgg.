import webpush from 'web-push';
import { z } from 'zod';
import { DOORBELL, PUSH_HOSTS, PUSH_KEY_PATTERN, HTTP } from '@/constants/doorbell';
import type { DeliveryStatus } from '@/types/doorbell';
import type { Database } from './database';
import { getConfig } from './config';
import { AppError } from './errors';

export const subscriptionSchema = z.object({
  endpoint: z.url().max(2048).refine((endpoint) => {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && PUSH_HOSTS.some((host) => url.hostname === host || (host === 'web.push.apple.com' && url.hostname.endsWith(`.${host}`)));
  }, 'Proveedor de notificaciones no compatible.'),
  keys: z.object({ p256dh: z.string().length(87).regex(PUSH_KEY_PATTERN), auth: z.string().length(22).regex(PUSH_KEY_PATTERN) }),
});

export async function saveDevice(database: Database, name: string, subscription: webpush.PushSubscription) {
  return database.transaction(async (transaction) => {
    await transaction.query('SELECT id FROM homes WHERE id = 1 FOR UPDATE');
    const existing = await transaction.query('SELECT id FROM devices WHERE endpoint = $1', [subscription.endpoint]);
    const count = await transaction.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM devices');
    if (!existing.rows.length && Number(count.rows[0].count) >= DOORBELL.maxDevices) throw new AppError(HTTP.conflict, 'DEVICE_LIMIT', 'Llegaste al límite de 10 celulares. Eliminá uno para agregar otro.');
    await transaction.query('INSERT INTO devices (id, name, endpoint, subscription) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (endpoint) DO UPDATE SET name = EXCLUDED.name, subscription = EXCLUDED.subscription', [crypto.randomUUID(), name, subscription.endpoint, JSON.stringify(subscription)]);
  });
}

/** Each provider send is awaited; expired endpoints are removed and mixed outcomes stay explicit. */
export async function sendPush(database: Database, message: string, visitId?: string, deviceId?: string): Promise<{ delivery: DeliveryStatus; accepted: number; total: number }> {
  const config = getConfig();
  const devices = await database.query<{ id: string; subscription: webpush.PushSubscription }>(`SELECT id, subscription FROM devices${deviceId ? ' WHERE id = $1' : ''} LIMIT $${deviceId ? 2 : 1}`, deviceId ? [deviceId, DOORBELL.maxDevices] : [DOORBELL.maxDevices]);
  if (!config.publicKey || !config.privateKey || !devices.rows.length) return { delivery: 'unavailable', accepted: 0, total: devices.rows.length };
  const results = await Promise.allSettled(devices.rows.map(async (device) => {
    try {
      await webpush.sendNotification(device.subscription, JSON.stringify({ title: visitId ? 'Hay alguien en la puerta' : 'Tu timbre está listo', body: message || 'Tocaron el timbre. Abrí Ringgg para responder.', url: '/', tag: visitId || crypto.randomUUID() }), {
        vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
        TTL: DOORBELL.pushTtlSeconds, urgency: 'high', timeout: DOORBELL.pushTimeoutMs,
      });
    } catch (error) {
      const status = error instanceof webpush.WebPushError ? error.statusCode : undefined;
      if (status === 404 || status === 410) await database.query('DELETE FROM devices WHERE id = $1', [device.id]);
      console.error(JSON.stringify({ operation: 'push.send', deviceId: device.id, status, visitId }));
      throw new AppError(HTTP.unavailable, 'PUSH_FAILED', 'No pudimos enviar el aviso a este celular.', { cause: error });
    }
  }));
  const accepted = results.filter((result) => result.status === 'fulfilled').length;
  return { delivery: accepted === results.length ? 'sent' : accepted ? 'partial' : 'unavailable', accepted, total: results.length };
}
