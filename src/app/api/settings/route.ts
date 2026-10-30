import { z } from 'zod';
import { DOORBELL } from '@/constants/doorbell';
import { requireAuth } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { snapshot, updateHomeSettings } from '@/server/doorbell';
import { apiRoute, readJson } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const settingsSchema = z.object({ name: z.string().trim().min(1).max(DOORBELL.nameMaxLength), enabled: z.boolean() });

export const POST = apiRoute('settings', async (request) => {
  await requireAuth();
  const input = await readJson(request, settingsSchema);
  const database = await getDatabase();
  await updateHomeSettings(database, input.name, input.enabled);
  return Response.json(await snapshot(database));
});
