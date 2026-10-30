import { z } from 'zod';
import { requireIdentity } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { apiRoute, readJson } from '@/server/http';
import { renewSubscription, subscriptionSchema } from '@/server/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const renewalSchema = z.object({ subscription: subscriptionSchema, previousEndpoint: subscriptionSchema.shape.endpoint });

/** Called by the service worker when the browser replaces the subscription: the device keeps every home and name. */
export const POST = apiRoute('renew-subscription', async (request) => {
  const user = await requireIdentity();
  const input = await readJson(request, renewalSchema);
  return Response.json(await renewSubscription(await getDatabase(), user, input.subscription, input.previousEndpoint));
});
