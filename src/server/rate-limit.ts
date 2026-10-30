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
  const counters = await transaction.query<{ key: string; attempts: number }>('SELECT key, attempts FROM rate_limits WHERE key = ANY($1::text[])', [[cooldownKey, windowKey]]);
  if (counters.rows.some((row) => row.key === cooldownKey)) throw new AppError(HTTP.tooMany, 'COOLDOWN', `Ya tocaste el timbre hace poco. Esperá ${RING_LIMITS.clientCooldownSeconds} segundos.`);
  const attempts = counters.rows.find((row) => row.key === windowKey)?.attempts ?? 0;
  if (attempts >= RING_LIMITS.clientMaxPerWindow) throw new AppError(HTTP.tooMany, 'RATE_LIMITED', 'Tocaste el timbre varias veces seguidas. Probá de nuevo en unos minutos.');
  const recent = await transaction.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM visits WHERE created_at > NOW() - $1 * INTERVAL '1 second'`, [RING_LIMITS.homeWindowSeconds]);
  if (Number(recent.rows[0].count) >= RING_LIMITS.homeMaxPerWindow) throw new AppError(HTTP.tooMany, 'BUSY', 'Este timbre recibió muchos avisos seguidos. Esperá unos minutos.');
  await transaction.query(`INSERT INTO rate_limits (key, attempts, expires_at) VALUES ($1, 1, NOW() + $2 * INTERVAL '1 second')`, [cooldownKey, RING_LIMITS.clientCooldownSeconds]);
  await transaction.query(`INSERT INTO rate_limits (key, attempts, expires_at) VALUES ($1, 1, NOW() + $2 * INTERVAL '1 second') ON CONFLICT (key) DO UPDATE SET attempts = rate_limits.attempts + 1`, [windowKey, RING_LIMITS.clientWindowSeconds]);
}
