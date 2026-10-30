import { z } from 'zod';
import { requireAuth } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { apiRoute, readJson } from '@/server/http';
import { removeDevice } from '@/server/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Shared management: any resident can disconnect a device of the home, for example a lost phone. */
export const POST = apiRoute('remove-device', async (request) => {
  await requireAuth();
  const input = await readJson(request, z.object({ id: z.uuid() }));
  await removeDevice(await getDatabase(), input.id);
  return Response.json({ ok: true });
});
