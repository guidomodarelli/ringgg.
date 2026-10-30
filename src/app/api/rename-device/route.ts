import { z } from 'zod';
import { requireHome, requireIdentity } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { snapshot } from '@/server/doorbell';
import { homeIdSchema } from '@/server/homes';
import { apiRoute, readJson } from '@/server/http';
import { renameDevice } from '@/server/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const renameSchema = z.object({ home: homeIdSchema, id: z.uuid(), name: z.string() });

/** Shared management: any resident names the devices of their home; names are required and unique there. */
export const POST = apiRoute('rename-device', async (request) => {
  const user = await requireIdentity();
  const input = await readJson(request, renameSchema);
  const member = await requireHome(user, input.home);
  const database = await getDatabase();
  await renameDevice(database, member.homeId, input.id, input.name);
  return Response.json(await snapshot(database, member.homeId));
});
