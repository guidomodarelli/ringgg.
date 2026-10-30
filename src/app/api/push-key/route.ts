import { requireIdentity } from '@/server/auth';
import { getConfig } from '@/server/config';
import { apiRoute } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The same key for every home: one browser subscription can ring for several homes. */
export const GET = apiRoute('push-key', async () => {
  await requireIdentity();
  return Response.json({ publicKey: getConfig().publicKey });
});
