import { z } from 'zod';
import { requireHome, requireIdentity } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { homeIdSchema } from '@/server/homes';
import { apiRoute, readJson } from '@/server/http';
import { findOwnDevice, subscriptionSchema } from '@/server/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tells this browser whether it rings for this home under the current resident, and which device it is. */
export const POST = apiRoute('device-status', async (request) => {
  const user = await requireIdentity();
  const input = await readJson(request, z.object({ home: homeIdSchema, endpoint: subscriptionSchema.shape.endpoint }));
  const member = await requireHome(user, input.home);
  return Response.json(await findOwnDevice(await getDatabase(), input.endpoint, member));
});
