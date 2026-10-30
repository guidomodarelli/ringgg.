import webpush from 'web-push';
import { z } from 'zod';
import { HTTP, NOTIFICATION_REPLIES, VISIT_REPLIES } from '@/constants/doorbell';
import { DEVICES } from '@/constants/devices';
import { HOMES } from '@/constants/homes';
import { PUSH, PUSH_HOSTS, PUSH_KEY_PATTERN, PUSH_POLICIES, type PushKind } from '@/constants/push';
import { cleanName, nameKey, uniqueName } from '@/lib/names';
import type { DeliveryStatus } from '@/types/doorbell';
import type { HomeMember } from '@/types/residents';
import type { Database } from './database';
import { getConfig, pushConfigured } from './config';
import { AppError, logError } from './errors';
import { memberName, resolveHomeAccess, residentSettings } from './residents';
import { takenDeviceNames } from './device-names';
import type { ResidentIdentity } from '../types/auth';

const UNIQUE_VIOLATION = '23505';

export const subscriptionSchema = z.object({
  endpoint: z.url().max(PUSH.endpointMaxLength).refine((endpoint) => {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && PUSH_HOSTS.some((host) => url.hostname === host || (host === 'web.push.apple.com' && url.hostname.endsWith(`.${host}`)));
  }, 'Proveedor de notificaciones no compatible.'),
  keys: z.object({ p256dh: z.string().length(PUSH.keyLengths.p256dh).regex(PUSH_KEY_PATTERN), auth: z.string().length(PUSH.keyLengths.auth).regex(PUSH_KEY_PATTERN) }),
});

/** Required, without surrounding spaces. */
export const deviceNameSchema = z.string().transform(cleanName).pipe(z.string().min(1).max(DEVICES.nameMaxLength));

function normalizedEmail(email: string) { return email.trim().toLowerCase(); }

/** This browser's device in this home, while its subscription is registered to the current resident. */
export async function findOwnDevice(database: Database, endpoint: string, member: HomeMember): Promise<{ active: boolean; deviceId: string | null }> {
  const result = await database.query<{ id: string }>(
    'SELECT d.id FROM devices d JOIN device_homes dh ON dh.device_id = d.id AND dh.home_id = $3 WHERE d.endpoint = $1 AND d.resident_email = $2',
    [endpoint, normalizedEmail(member.email), member.homeId],
  );
  return { active: result.rows.length > 0, deviceId: result.rows[0]?.id ?? null };
}

export interface DeviceRegistration {
  /** The home this browser starts ringing for. */
  homeId: number;
  subscription: webpush.PushSubscription;
  /** Suggested name ("iPhone de Guido"); a number is added if the home already uses it. */
  name?: string;
}

/** The browser's device row, owned by `owner`. A browser that changes hands stops ringing for the previous owner's homes. */
async function upsertDevice(database: Database, subscription: webpush.PushSubscription, owner: { email: string; name: string }, deviceName: string): Promise<string> {
  const { email } = owner;
  const [previous] = (await database.query<{ id: string; resident_email: string | null }>('SELECT id, resident_email FROM devices WHERE endpoint = $1', [subscription.endpoint])).rows;
  if (previous && previous.resident_email !== email) await database.query('DELETE FROM device_homes WHERE device_id = $1', [previous.id]);
  const saved = await database.query<{ id: string }>(
    `INSERT INTO devices (id, name, endpoint, subscription, resident_email, owner_name) VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE SET subscription = EXCLUDED.subscription, resident_email = EXCLUDED.resident_email, owner_name = EXCLUDED.owner_name
     RETURNING id`,
    [crypto.randomUUID(), deviceName, subscription.endpoint, JSON.stringify(subscription), email, owner.name],
  );
  return saved.rows[0].id;
}

/**
 * Registers this browser for one home, under the home lock and within its device limit, and returns
 * the device id so the panel can mark "this device" without another request. The same browser can
 * ring for several homes, with a name of its own in each, unique in that home.
 */
export async function saveDevice(database: Database, registration: DeviceRegistration, user: ResidentIdentity, settings = residentSettings()): Promise<{ deviceId: string }> {
  const email = normalizedEmail(user.email);
  const { homeId } = registration;
  return database.transaction(async (transaction) => {
    await transaction.query('SELECT id FROM homes WHERE id = $1 FOR UPDATE', [homeId]);
    const member = await resolveHomeAccess(transaction, user, homeId, settings);
    const suggested = registration.name ? cleanName(registration.name) : DEVICES.defaultName;
    const deviceId = await upsertDevice(transaction, registration.subscription, { email, name: memberName(member) }, suggested);
    const registered = await transaction.query('SELECT 1 FROM device_homes WHERE device_id = $1 AND home_id = $2', [deviceId, homeId]);
    if (registered.rows.length) return { deviceId };
    const count = await transaction.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM device_homes WHERE home_id = $1', [homeId]);
    if (count.rows[0].count >= DEVICES.max) throw new AppError(HTTP.conflict, 'DEVICE_LIMIT', `Llegaste al límite de ${DEVICES.max} celulares en esta casa. Eliminá uno para agregar otro.`);
    const name = uniqueName(suggested, await takenDeviceNames(transaction, homeId), DEVICES.nameMaxLength);
    await transaction.query('INSERT INTO device_homes (device_id, home_id, name, name_key) VALUES ($1, $2, $3, $4)', [deviceId, homeId, name, nameKey(name)]);
    return { deviceId };
  });
}

/**
 * The service worker reports a subscription the browser replaced: the same device takes the new
 * endpoint and keeps its homes and names. Nothing changes when the old endpoint is not this resident's,
 * or when the new one is already another resident's device: the panel then offers to connect again.
 */
export async function renewSubscription(database: Database, user: ResidentIdentity, subscription: webpush.PushSubscription, previousEndpoint: string): Promise<{ renewed: boolean }> {
  const email = normalizedEmail(user.email);
  return database.transaction(async (transaction) => {
    const [previous] = (await transaction.query<{ id: string }>('SELECT id FROM devices WHERE endpoint = $1 AND resident_email = $2', [previousEndpoint, email])).rows;
    if (!previous || previousEndpoint === subscription.endpoint) return { renewed: false };
    const [current] = (await transaction.query<{ id: string; resident_email: string | null }>('SELECT id, resident_email FROM devices WHERE endpoint = $1', [subscription.endpoint])).rows;
    if (!current) {
      await transaction.query('UPDATE devices SET endpoint = $2, subscription = $3::jsonb WHERE id = $1', [previous.id, subscription.endpoint, JSON.stringify(subscription)]);
      return { renewed: true };
    }
    // Another resident's device keeps only its own homes: merging would make it ring for homes its
    // owner cannot open, and removing this resident from them would not disconnect it.
    if (current.resident_email !== email) return { renewed: false };
    // Both exist: the homes the current device was missing move to it with their names (moving the
    // rows keeps each name unique in its home), then the old device goes with the homes both had.
    await transaction.query(
      'UPDATE device_homes SET device_id = $1 WHERE device_id = $2 AND home_id NOT IN (SELECT home_id FROM device_homes WHERE device_id = $1)',
      [current.id, previous.id],
    );
    await transaction.query('DELETE FROM devices WHERE id = $1', [previous.id]);
    return { renewed: true };
  });
}

function deviceNameTaken(name: string) {
  return new AppError(HTTP.conflict, 'DEVICE_NAME_TAKEN', `Ya hay un celular llamado «${name}» en esta casa. Elegí otro nombre.`);
}

/** Shared management: residents of a home name its devices; the name is required and unique in the home. */
export async function renameDevice(database: Database, homeId: number, id: string, input: string) {
  const name = deviceNameSchema.parse(input);
  try {
    await database.transaction(async (transaction) => {
      await transaction.query('SELECT id FROM homes WHERE id = $1 FOR UPDATE', [homeId]);
      const registered = await transaction.query('SELECT 1 FROM device_homes WHERE device_id = $1 AND home_id = $2', [id, homeId]);
      if (!registered.rows.length) throw new AppError(HTTP.notFound, 'DEVICE_NOT_FOUND', 'Ese celular ya no está conectado. Actualizá la lista.');
      if ((await takenDeviceNames(transaction, homeId, id)).some((taken) => nameKey(taken) === nameKey(name))) throw deviceNameTaken(name);
      await transaction.query('UPDATE device_homes SET name = $3, name_key = $4 WHERE device_id = $1 AND home_id = $2', [id, homeId, name, nameKey(name)]);
    });
  } catch (error) {
    if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) throw deviceNameTaken(name);
    throw error;
  }
}

/** Stops a device from ringing for this home only; a device left without homes is forgotten. */
export async function removeDevice(database: Database, homeId: number, id: string) {
  await database.transaction(async (transaction) => {
    await transaction.query('DELETE FROM device_homes WHERE device_id = $1 AND home_id = $2', [id, homeId]);
    await transaction.query('DELETE FROM devices d WHERE d.id = $1 AND NOT EXISTS (SELECT 1 FROM device_homes dh WHERE dh.device_id = d.id)', [id]);
  });
}

/**
 * The service worker confirms a push reached the device. One statement marks the device and, for
 * a visit, records one receipt per device; repeated receipts are ignored.
 */
export async function recordPushReceipt(database: Database, endpoint: string, visitId: string | null): Promise<{ recorded: boolean }> {
  const result = await database.query<{ id: string }>(
    `WITH device AS (UPDATE devices SET last_received_at = NOW() WHERE endpoint = $1 RETURNING id),
     receipt AS (INSERT INTO visit_receipts (visit_id, device_id) SELECT v.id, device.id FROM device JOIN visits v ON v.id = $2 ON CONFLICT DO NOTHING)
     SELECT id FROM device`,
    [endpoint, visitId],
  );
  return { recorded: result.rows.length > 0 };
}

export interface PushRequest {
  kind: PushKind;
  /** The home whose devices receive it; the notification opens that home. */
  homeId: number;
  title: string;
  body: string;
  /** Visit the notification belongs to: it opens that visit and, when answerable, offers replies. */
  visitId?: string;
  answerable?: boolean;
  deviceId?: string;
  residentEmail?: string;
}

/** Payload read by the service worker. The URL is always a same-origin dashboard path of the home. */
export function pushPayload(request: PushRequest) {
  const home = `${HOMES.queryParameter}=${request.homeId}`;
  return {
    kind: request.kind,
    title: request.title,
    body: request.body,
    url: request.visitId ? `/?${home}&view=history&visit=${encodeURIComponent(request.visitId)}` : `/?${home}`,
    tag: request.visitId || crypto.randomUUID(),
    visitId: request.visitId,
    replies: request.visitId && request.answerable ? NOTIFICATION_REPLIES.map((reply) => ({ reply, title: VISIT_REPLIES[reply].label })) : [],
  };
}

interface SendOutcome { id: string; accepted: boolean; status: number | null }

/** Every device took the push, only some of them, or none. */
function deliveryStatus(accepted: number, total: number): DeliveryStatus {
  if (accepted === total) return 'sent';
  return accepted ? 'partial' : 'unavailable';
}

/** One statement stores what the provider answered for every device of this send. */
async function recordDeliveryHealth(database: Database, outcomes: SendOutcome[]) {
  const tracked = outcomes.filter((outcome) => outcome.accepted || !PUSH.goneStatuses.includes(outcome.status ?? 0));
  if (!tracked.length) return;
  await database.query(
    `UPDATE devices AS d SET
       last_success_at = CASE WHEN r.accepted THEN NOW() ELSE d.last_success_at END,
       last_failure_at = CASE WHEN r.accepted THEN d.last_failure_at ELSE NOW() END,
       last_failure_status = CASE WHEN r.accepted THEN d.last_failure_status ELSE r.status END
     FROM unnest($1::text[], $2::boolean[], $3::int[]) AS r(id, accepted, status) WHERE d.id = r.id`,
    [tracked.map((outcome) => outcome.id), tracked.map((outcome) => outcome.accepted), tracked.map((outcome) => outcome.status)],
  );
}

/** The devices of a home, optionally only one device or only one resident's. */
async function homeDevices(database: Database, request: PushRequest) {
  const filters = ['dh.home_id = $1'];
  const parameters: unknown[] = [request.homeId];
  if (request.deviceId) { parameters.push(request.deviceId); filters.push(`d.id = $${parameters.length}`); }
  if (request.residentEmail !== undefined) { parameters.push(normalizedEmail(request.residentEmail)); filters.push(`d.resident_email = $${parameters.length}`); }
  parameters.push(DEVICES.max);
  const result = await database.query<{ id: string; subscription: webpush.PushSubscription }>(
    `SELECT d.id, d.subscription FROM devices d JOIN device_homes dh ON dh.device_id = d.id WHERE ${filters.join(' AND ')} LIMIT $${parameters.length}`,
    parameters,
  );
  return result.rows;
}

/**
 * Each provider send is awaited with the policy of its kind; expired endpoints are removed, every
 * other outcome is stored as device health, and mixed results stay explicit.
 */
export async function sendPush(database: Database, request: PushRequest): Promise<{ delivery: DeliveryStatus; accepted: number; total: number }> {
  const config = getConfig();
  const devices = await homeDevices(database, request);
  if (!pushConfigured(config) || !devices.length) return { delivery: 'unavailable', accepted: 0, total: devices.length };
  const payload = JSON.stringify(pushPayload(request));
  const policy = PUSH_POLICIES[request.kind];
  const outcomes = await Promise.all(devices.map(async (device): Promise<SendOutcome> => {
    try {
      await webpush.sendNotification(device.subscription, payload, {
        vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
        TTL: policy.ttlSeconds, urgency: policy.urgency, timeout: PUSH.timeoutMs,
      });
      return { id: device.id, accepted: true, status: null };
    } catch (error) {
      const status = error instanceof webpush.WebPushError ? error.statusCode : null;
      logError('push.send', error, { deviceId: device.id, status, kind: request.kind, visitId: request.visitId, homeId: request.homeId });
      if (PUSH.goneStatuses.includes(status ?? 0)) {
        await database.query('DELETE FROM devices WHERE id = $1', [device.id])
          .catch((cleanupError: unknown) => { logError('push.removeExpiredDevice', cleanupError, { deviceId: device.id }); });
      }
      return { id: device.id, accepted: false, status };
    }
  }));
  // Health is informative: failing to store it must not turn a delivered ring into an error.
  await recordDeliveryHealth(database, outcomes).catch((healthError: unknown) => { logError('push.recordDeliveryHealth', healthError, { kind: request.kind, visitId: request.visitId }); });
  const accepted = outcomes.filter((outcome) => outcome.accepted).length;
  return { delivery: deliveryStatus(accepted, outcomes.length), accepted, total: outcomes.length };
}
