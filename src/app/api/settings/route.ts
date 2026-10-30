import { z } from 'zod';
import { requireHome, requireIdentity } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { snapshot, updateHomeName } from '@/server/doorbell';
import { homeIdSchema } from '@/server/homes';
import { apiRoute, readJson } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const settingsSchema = z.object({ home: homeIdSchema, name: z.string() });

/** Renames the home; pausing goes through `/api/pause`, so saving a name never changes the bell state. */
export const POST = apiRoute('settings', async (request) => {
  const user = await requireIdentity();
  const input = await readJson(request, settingsSchema);
  const member = await requireHome(user, input.home);
  const database = await getDatabase();
  await updateHomeName(database, member, input.name);
  return Response.json(await snapshot(database, member.homeId));
});
