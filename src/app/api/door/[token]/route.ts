import { z } from 'zod';
import { DOORBELL } from '@/constants/doorbell';
import { getDatabase } from '@/server/database';
import { publicHome, ringAndNotify } from '@/server/doorbell';
import { apiRoute, readJson } from '@/server/http';
import { ringClientKey } from '@/server/rate-limit';
import { positionSchema } from '@/server/location';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { token: string };
/** `position` only when the home asks visitors to be at the door: it is checked and dropped. */
const ringSchema = z.object({ id: z.uuid(), message: z.string().trim().max(DOORBELL.messageMaxLength), position: positionSchema.nullish() });

/** Public capability: reading the doorbell never exposes private home data. */
export const GET = apiRoute<Params>('door', async (_request, { token }) => Response.json(await publicHome(await getDatabase(), token)));

/** Retries with the same operation id return the stored visit and notify only if no request did. */
export const POST = apiRoute<Params>('door', async (request, { token }) => {
  const input = await readJson(request, ringSchema);
  const ring = { id: input.id, message: input.message, client: ringClientKey(request.headers), position: input.position };
  return Response.json(await ringAndNotify(await getDatabase(), token, ring));
});
