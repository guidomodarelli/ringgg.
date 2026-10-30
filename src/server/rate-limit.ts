import { createHash } from 'node:crypto';
import { HTTP, RING_LIMITS } from '@/constants/doorbell';
import type { Database } from './database';
import { AppError } from './errors';

/**
 * Identifies a visitor client without storing its address: a salted hash of the first
 * forwarded address. Vercel overwrites `x-forwarded-for`, so clients cannot spoof it there.
 */
export function ringClientKey(headers: Headers, secret = process.env.NEON_AUTH_COOKIE_SECRET || process.env.SESSION_SECRET || 'ringgg') {
  const address = headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || 'unknown';
  return createHash('sha256').update(`${secret}:${address}`).digest('base64url').slice(0, 32);
}

/**
 * Runs inside the visit transaction, after the home row lock, so every instance sees the
 * same counters. Limits only consume allowance when the visit is actually created.
 */
export async function enforceRingLimits(transaction: Database, client: string) {
  await transaction.query('DELETE FROM rate_limits WHERE expires_at <= NOW()');
  const cooldownKey = `ring-cooldown:${client}`;
  const windowKey = `ring-window:${client}`;
  // One round trip reads the client's counters and the home-wide count.
  const counters = (await transaction.query<{ cooling: boolean; attempts: number; recent: number }>(
    `SELECT EXISTS(SELECT 1 FROM rate_limits WHERE key = $1) AS cooling,
            COALESCE((SELECT attempts FROM rate_limits WHERE key = $2), 0) AS attempts,
            (SELECT COUNT(*) FROM visits WHERE created_at > NOW() - $3 * INTERVAL '1 second')::int AS recent`,
    [cooldownKey, windowKey, RING_LIMITS.homeWindowSeconds],
  )).rows[0];
  if (counters.cooling) throw new AppError(HTTP.tooMany, 'COOLDOWN', `Ya tocaste el timbre hace poco. Esperá ${RING_LIMITS.clientCooldownSeconds} segundos.`);
  if (Number(counters.attempts) >= RING_LIMITS.clientMaxPerWindow) throw new AppError(HTTP.tooMany, 'RATE_LIMITED', 'Tocaste el timbre varias veces seguidas. Probá de nuevo en unos minutos.');
  if (Number(counters.recent) >= RING_LIMITS.homeMaxPerWindow) throw new AppError(HTTP.tooMany, 'BUSY', 'Este timbre recibió muchos avisos seguidos. Esperá unos minutos.');
  // The cooldown row cannot exist here (checked above under the home lock), so only the window row upserts.
  await transaction.query(
    `INSERT INTO rate_limits (key, attempts, expires_at) VALUES ($1, 1, NOW() + $3 * INTERVAL '1 second'), ($2, 1, NOW() + $4 * INTERVAL '1 second')
     ON CONFLICT (key) DO UPDATE SET attempts = rate_limits.attempts + 1`,
    [cooldownKey, windowKey, RING_LIMITS.clientCooldownSeconds, RING_LIMITS.clientWindowSeconds],
  );
}
