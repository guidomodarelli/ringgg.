import { z } from 'zod';
import { VISIT_REPLY_KEYS } from '@/constants/doorbell';
import { requireAuth } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { answerVisit } from '@/server/doorbell';
import { apiRoute, readJson, residentDisplayName } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const answerSchema = z.object({ id: z.uuid(), reply: z.enum(VISIT_REPLY_KEYS).default('coming') });

/** Also called by the service worker from a notification action, with the resident's cookies. */
export const POST = apiRoute('answer', async (request) => {
  const user = await requireAuth();
  const input = await readJson(request, answerSchema);
  return Response.json(await answerVisit(await getDatabase(), input.id, input.reply, residentDisplayName(user)));
});
