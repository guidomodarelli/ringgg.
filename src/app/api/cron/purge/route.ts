import { requireCronSecret } from '@/server/cron';
import { getDatabase } from '@/server/database';
import { purgeExpiredData } from '@/server/doorbell';
import { apiRoute } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Daily Vercel Cron job (see `vercel.json`): keeps the retention promise even when nobody rings, for visits
 * and everything recorded about them (rejected rings, per-device deliveries, removed devices).
 */
export const GET = apiRoute('cron.purge', async (request) => {
  requireCronSecret(request);
  const purged = await purgeExpiredData(await getDatabase());
  console.info(JSON.stringify({ level: 'info', operation: 'cron.purge', ...purged }));
  return Response.json(purged);
});
