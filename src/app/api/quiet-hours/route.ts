import { z } from 'zod';
import { QUIET_HOURS_PATTERN } from '@/constants/doorbell';
import { requireAuth } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { snapshot, updateQuietHours } from '@/server/doorbell';
import { apiRoute, readJson } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const time = z.string().regex(QUIET_HOURS_PATTERN).nullable();
const quietHoursSchema = z.object({ start: time, end: time });

export const POST = apiRoute('quiet-hours', async (request) => {
  await requireAuth();
  const input = await readJson(request, quietHoursSchema);
  const database = await getDatabase();
  await updateQuietHours(database, input.start, input.end);
  return Response.json(await snapshot(database));
});
