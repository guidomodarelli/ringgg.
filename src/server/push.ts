import webpush from 'web-push';
import { z } from 'zod';
import { DOORBELL, PUSH_HOSTS, PUSH_KEY_PATTERN, HTTP } from '@/constants/doorbell';
import type { DeliveryStatus } from '@/types/doorbell';
import type { Database } from './database';
import { getConfig } from './config';
import { AppError } from './errors';
import { resolveResidentAccess, residentSettings } from './residents';
import type { ResidentIdentity } from '../types/auth';

export const subscriptionSchema = z.object({
  endpoint: z.url().max(2048).refine((endpoint) => {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && PUSH_HOSTS.some((host) => url.hostname === host || (host === 'web.push.apple.com' && url.hostname.endsWith(`.${host}`)));
  }, 'Proveedor de notificaciones no compatible.'),
  keys: z.object({ p256dh: z.string().length(87).regex(PUSH_KEY_PATTERN), auth: z.string().length(22).regex(PUSH_KEY_PATTERN) }),
});

/** A browser subscription is active only while it is registered to the current resident. */
export async function hasRegisteredDevice(database: Database, endpoint: string, user: ResidentIdentity): Promise<boolean> {
  const result = await database.query<{ present: boolean }>('SELECT EXISTS(SELECT 1 FROM devices WHERE endpoint = $1 AND resident_email = $2) AS present', [endpoint, user.email.trim().toLowerCase()]);
  return result.rows[0].present;
}

export async function saveDevice(database: Database, name: string, subscription: webpush.PushSubscription, user: ResidentIdentity, settings = residentSettings()) {
  return database.transaction(async (transaction) => {
    await transaction.query('SELECT id FROM homes WHERE id = 1 FOR UPDATE');
    await resolveResidentAccess(transaction, user, settings);
    const existing = await transaction.query('SELECT id FROM devices WHERE endpoint = $1', [subscription.endpoint]);
    const count = await transaction.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM devices');
    if (!existing.rows.length && Number(count.rows[0].count) >= DOORBELL.maxDevices) throw new AppError(HTTP.conflict, 'DEVICE_LIMIT', 'Llegaste al límite de 10 celulares. Eliminá uno para agregar otro.');
    await transaction.query('INSERT INTO devices (id, name, endpoint, subscription, resident_email) VALUES ($1, $2, $3, $4::jsonb, $5) ON CONFLICT (endpoint) DO UPDATE SET name = EXCLUDED.name, subscription = EXCLUDED.subscription, resident_email = EXCLUDED.resident_email', [crypto.randomUUID(), name, subscription.endpoint, JSON.stringify(subscription), user.email.trim().toLowerCase()]);
  });
}

/** Each provider send is awaited; expired endpoints are removed and mixed outcomes stay explicit. */
export async function sendPush(database: Database, message: string, visitId?: string, deviceId?: string, residentEmail?: string): Promise<{ delivery: DeliveryStatus; accepted: number; total: number }> {
  const config = getConfig();
  const filters: string[] = [];
  const parameters: unknown[] = [];
  if (deviceId) { parameters.push(deviceId); filters.push(`id = $${parameters.length}`); }
  if (residentEmail !== undefined) { parameters.push(residentEmail.trim().toLowerCase()); filters.push(`resident_email = $${parameters.length}`); }
  parameters.push(DOORBELL.maxDevices);
  const devices = await database.query<{ id: string; subscription: webpush.PushSubscription }>(`SELECT id, subscription FROM devices${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''} LIMIT $${parameters.length}`, parameters);
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
