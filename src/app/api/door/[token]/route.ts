import { z } from 'zod';
import { DOORBELL } from '@/constants/doorbell';
import { getDatabase } from '@/server/database';
import { publicHome, registerVisit, setDelivery } from '@/server/doorbell';
import { apiRoute, readJson } from '@/server/http';
import { sendPush } from '@/server/push';
import { ringClientKey } from '@/server/rate-limit';
import { positionSchema } from '@/server/location';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { token: string };
/** `position` only when the home asks visitors to be at the door: it is checked and dropped. */
const ringSchema = z.object({ id: z.uuid(), message: z.string().trim().max(DOORBELL.messageMaxLength), position: positionSchema.nullish() });

/** Public capability: reading the doorbell never exposes private home data. */
export const GET = apiRoute<Params>('door', async (_request, { token }) => Response.json(await publicHome(await getDatabase(), token)));

/** Retries with the same operation id return the stored visit and never notify twice. */
export const POST = apiRoute<Params>('door', async (request, { token }) => {
  const input = await readJson(request, ringSchema);
  const database = await getDatabase();
  const result = await registerVisit(database, token, { id: input.id, message: input.message, client: ringClientKey(request.headers), position: input.position });
  // A retry returns the visit read inside the registration transaction; a new visit returns the stored delivery.
  if (!result.created) return Response.json(result.visit);
  // The title names the home: a resident of several homes knows which door rang.
  const outcome = await sendPush(database, { kind: 'ring', homeId: result.home.id, title: `${result.home.name}: hay alguien en la puerta`, body: input.message || 'Tocaron el timbre. Abrí Ringgg para responder.', visitId: input.id, answerable: true });
  return Response.json(await setDelivery(database, input.id, outcome.delivery));
});
