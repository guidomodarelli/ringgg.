import { z } from 'zod';
import { requireIdentity } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { createHome } from '@/server/homes';
import { apiRoute, readJson } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Creates another home for a resident; the panel then opens it. */
export const POST = apiRoute('homes', async (request) => {
  const user = await requireIdentity();
  const input = await readJson(request, z.object({ name: z.string() }));
  return Response.json(await createHome(await getDatabase(), user, input.name));
});
