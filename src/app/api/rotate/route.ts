import { requireAuth } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { rotateToken, snapshot } from '@/server/doorbell';
import { apiRoute } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = apiRoute('rotate', async () => {
  await requireAuth();
  const database = await getDatabase();
  await rotateToken(database);
  return Response.json(await snapshot(database));
});
