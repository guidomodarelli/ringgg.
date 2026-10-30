import { z } from 'zod';
import { requireIdentity } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { apiRoute, readJson } from '@/server/http';
import { recordPushReceipt, subscriptionSchema } from '@/server/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const receiptSchema = z.object({ endpoint: subscriptionSchema.shape.endpoint, visitId: z.uuid().nullable().default(null) });

/** The service worker confirms a push reached this device, with the resident's cookies. */
export const POST = apiRoute('push-receipt', async (request) => {
  await requireIdentity();
  const input = await readJson(request, receiptSchema);
  return Response.json(await recordPushReceipt(await getDatabase(), input.endpoint, input.visitId));
});
