import { z } from 'zod';
import { VISIT_REPLY_KEYS } from '@/constants/doorbell';
import { requireIdentity } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { answerVisit, visitHomeId } from '@/server/doorbell';
import { apiRoute, readJson } from '@/server/http';
import { memberName, resolveHomeAccess } from '@/server/residents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const answerSchema = z.object({ id: z.uuid(), reply: z.enum(VISIT_REPLY_KEYS).default('coming') });

/**
 * Also called by the service worker from a notification action, with the resident's cookies. The visit
 * says which home it belongs to, and only a resident of that home can answer it.
 */
export const POST = apiRoute('answer', async (request) => {
  const user = await requireIdentity();
  const input = await readJson(request, answerSchema);
  const database = await getDatabase();
  const member = await resolveHomeAccess(database, user, await visitHomeId(database, input.id));
  return Response.json(await answerVisit(database, { homeId: member.homeId, id: input.id }, input.reply, memberName(member)));
});
