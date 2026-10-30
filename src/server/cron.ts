import { createHash, timingSafeEqual } from 'node:crypto';
import { HTTP } from '@/constants/doorbell';
import { AppError } from './errors';

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Without a configured secret the job
 * fails closed, and the comparison takes the same time whatever the received value is.
 */
export function requireCronSecret(request: Request, secret = process.env.CRON_SECRET) {
  if (!secret) throw new AppError(HTTP.unavailable, 'CRON_NOT_CONFIGURED', 'La tarea programada no está configurada.');
  const received = request.headers.get('authorization') ?? '';
  if (!timingSafeEqual(digest(received), digest(`Bearer ${secret}`))) throw new AppError(HTTP.unauthorized, 'CRON_UNAUTHORIZED', 'No autorizado.');
}
