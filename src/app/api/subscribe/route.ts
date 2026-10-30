import { z } from 'zod';
import { DOORBELL } from '@/constants/doorbell';
import { requireAuth } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { apiRoute, readJson } from '@/server/http';
import { saveDevice, subscriptionSchema } from '@/server/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const subscribeSchema = z.object({ name: z.string().trim().min(1).max(DOORBELL.nameMaxLength), subscription: subscriptionSchema });

export const POST = apiRoute('subscribe', async (request) => {
  const user = await requireAuth();
  const input = await readJson(request, subscribeSchema);
  await saveDevice(await getDatabase(), input.name, input.subscription, user);
  return Response.json({ ok: true });
});
