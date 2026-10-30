import { requireAuth } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { snapshot } from '@/server/doorbell';
import { apiRoute } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiRoute('dashboard', async () => {
  await requireAuth();
  return Response.json(await snapshot(await getDatabase()));
});
