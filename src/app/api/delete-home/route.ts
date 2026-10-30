import { z } from 'zod';
import { requireIdentity } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { deleteHome, homeIdSchema } from '@/server/homes';
import { apiRoute, readJson } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Deletes a home whose only resident is the caller, who keeps another one; answers which home to open next. */
export const POST = apiRoute('delete-home', async (request) => {
  const user = await requireIdentity();
  const input = await readJson(request, z.object({ home: homeIdSchema }));
  return Response.json(await deleteHome(await getDatabase(), user, input.home));
});
