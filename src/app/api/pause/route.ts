import { z } from 'zod';
import { PAUSE_MODES } from '@/constants/doorbell';
import { requireHome, requireIdentity } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { setPause, snapshot } from '@/server/doorbell';
import { homeIdSchema } from '@/server/homes';
import { apiRoute, readJson } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const pauseSchema = z.object({ home: homeIdSchema, mode: z.enum(PAUSE_MODES) });

/** Pauses for an hour, until the morning or until someone resumes it; `resume` ends any pause. */
export const POST = apiRoute('pause', async (request) => {
  const user = await requireIdentity();
  const input = await readJson(request, pauseSchema);
  const member = await requireHome(user, input.home);
  const database = await getDatabase();
  await setPause(database, member.homeId, input.mode);
  return Response.json(await snapshot(database, member.homeId));
});
