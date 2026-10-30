import { requireAuth } from '@/server/auth';
import { getConfig } from '@/server/config';
import { apiRoute } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiRoute('push-key', async () => {
  await requireAuth();
  return Response.json({ publicKey: getConfig().publicKey });
});
