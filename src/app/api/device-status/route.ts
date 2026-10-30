import { z } from 'zod';
import { requireAuth } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { apiRoute, readJson } from '@/server/http';
import { hasRegisteredDevice, subscriptionSchema } from '@/server/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = apiRoute('device-status', async (request) => {
  const user = await requireAuth();
  const input = await readJson(request, z.object({ endpoint: subscriptionSchema.shape.endpoint }));
  return Response.json({ active: await hasRegisteredDevice(await getDatabase(), input.endpoint, user) });
});
