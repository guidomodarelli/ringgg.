import { z } from 'zod';
import { QUIET_HOURS_PATTERN } from '@/constants/doorbell';
import { requireHome, requireIdentity } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { snapshot, updateQuietHours } from '@/server/doorbell';
import { homeIdSchema } from '@/server/homes';
import { apiRoute, readJson } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const time = z.string().regex(QUIET_HOURS_PATTERN).nullable();
const quietHoursSchema = z.object({ home: homeIdSchema, start: time, end: time });

export const POST = apiRoute('quiet-hours', async (request) => {
  const user = await requireIdentity();
  const input = await readJson(request, quietHoursSchema);
  const member = await requireHome(user, input.home);
  const database = await getDatabase();
  await updateQuietHours(database, member.homeId, input.start, input.end);
  return Response.json(await snapshot(database, member.homeId));
});
