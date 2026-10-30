import { z } from 'zod';
import { DOORBELL } from '@/constants/doorbell';
import { getDatabase } from '@/server/database';
import { publicHome, readVisit, registerVisit, setDelivery } from '@/server/doorbell';
import { apiRoute, readJson } from '@/server/http';
import { sendPush } from '@/server/push';
import { ringClientKey } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { token: string };
const ringSchema = z.object({ id: z.uuid(), message: z.string().trim().max(DOORBELL.messageMaxLength) });

/** Public capability: reading the doorbell never exposes private home data. */
export const GET = apiRoute<Params>('door', async (_request, { token }) => Response.json(await publicHome(await getDatabase(), token)));

/** Retries with the same operation id return the stored visit and never notify twice. */
export const POST = apiRoute<Params>('door', async (request, { token }) => {
  const input = await readJson(request, ringSchema);
  const database = await getDatabase();
  const result = await registerVisit(database, token, input.id, input.message, ringClientKey(request.headers));
  if (result.created) {
    const outcome = await sendPush(database, { title: 'Hay alguien en la puerta', body: input.message || 'Tocaron el timbre. Abrí Ringgg para responder.', visitId: input.id, answerable: true });
    await setDelivery(database, input.id, outcome.delivery);
  }
  return Response.json(await readVisit(database, token, input.id));
});
