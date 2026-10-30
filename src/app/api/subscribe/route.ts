import { z } from 'zod';
import { requireIdentity } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { homeIdSchema } from '@/server/homes';
import { apiRoute, readJson } from '@/server/http';
import { saveDevice, subscriptionSchema } from '@/server/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const subscribeSchema = z.object({
  home: homeIdSchema,
  /** Required: the device is named when it is connected (validated by `saveDevice`). */
  name: z.string(),
  subscription: subscriptionSchema,
});

/** Called by the panel when this browser starts ringing for a home; access is checked inside the device transaction. */
export const POST = apiRoute('subscribe', async (request) => {
  const user = await requireIdentity();
  const { home, ...registration } = await readJson(request, subscribeSchema);
  return Response.json(await saveDevice(await getDatabase(), { ...registration, homeId: home }, user));
});
