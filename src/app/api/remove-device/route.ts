import { z } from 'zod';
import { requireHome, requireIdentity } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { homeIdSchema } from '@/server/homes';
import { apiRoute, readJson } from '@/server/http';
import { removeDevice } from '@/server/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Shared management: any resident can disconnect a device from their home, for example a lost phone; its other homes are untouched. */
export const POST = apiRoute('remove-device', async (request) => {
  const user = await requireIdentity();
  const input = await readJson(request, z.object({ home: homeIdSchema, id: z.uuid() }));
  const member = await requireHome(user, input.home);
  await removeDevice(await getDatabase(), member.homeId, input.id);
  return Response.json({ ok: true });
});
