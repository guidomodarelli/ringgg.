import { z } from 'zod';
import { DEVICES } from '@/constants/devices';
import { requireIdentity } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { homeIdSchema } from '@/server/homes';
import { apiRoute, readJson } from '@/server/http';
import { saveDevice, subscriptionSchema } from '@/server/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const subscribeSchema = z.object({
  home: homeIdSchema,
  name: z.string().trim().min(1).max(DEVICES.nameMaxLength).optional(),
  subscription: subscriptionSchema,
});

/** Called by the panel when this browser starts ringing for a home; access is checked inside the device transaction. */
export const POST = apiRoute('subscribe', async (request) => {
  const user = await requireIdentity();
  const { home, ...registration } = await readJson(request, subscribeSchema);
  return Response.json(await saveDevice(await getDatabase(), { ...registration, homeId: home }, user));
});
