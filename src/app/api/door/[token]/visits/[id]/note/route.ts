import { z } from 'zod';
import { DOORBELL } from '@/constants/doorbell';
import { getDatabase } from '@/server/database';
import { leaveNote } from '@/server/doorbell';
import { apiRoute, readJson } from '@/server/http';
import { sendPush } from '@/server/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noteSchema = z.object({ note: z.string().trim().min(1).max(DOORBELL.noteMaxLength) });

/** One note per visit; only the first accepted note notifies the residents. */
export const POST = apiRoute<{ token: string; id: string }>('door.note', async (request, { token, id }) => {
  const input = await readJson(request, noteSchema);
  const database = await getDatabase();
  const result = await leaveNote(database, token, id, input.note);
  if (result.created) await sendPush(database, { title: 'Te dejaron un mensaje', body: input.note, visitId: id });
  return Response.json(result.visit);
});
