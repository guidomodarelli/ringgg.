import { z } from 'zod';
import { DOORBELL } from '@/constants/doorbell';
import { getDatabase } from '@/server/database';
import { leaveNoteAndNotify } from '@/server/doorbell';
import { apiRoute, readJson } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noteSchema = z.object({ note: z.string().trim().min(1).max(DOORBELL.noteMaxLength) });

/** One note per visit; it notifies the residents once, even when the request that stored it failed to. */
export const POST = apiRoute<{ token: string; id: string }>('door.note', async (request, { token, id }) => {
  const input = await readJson(request, noteSchema);
  return Response.json(await leaveNoteAndNotify(await getDatabase(), token, id, input.note));
});
