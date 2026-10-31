import { requireIdentity } from '@/server/auth';
import { residentChatAccess } from '@/server/chat';
import { getDatabase } from '@/server/database';
import { apiRoute } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `?visit=<id>`: a fresh token for a resident of that visit's home, for the origin the panel was opened on. */
export const GET = apiRoute('chat.access', async (request) => {
  const user = await requireIdentity();
  return Response.json(await residentChatAccess(await getDatabase(), user, request.nextUrl.searchParams.get('visit') ?? '', { pageOrigin: request.nextUrl.origin }));
});
