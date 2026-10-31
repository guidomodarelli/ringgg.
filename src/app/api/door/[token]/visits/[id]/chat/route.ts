import { visitorChatAccess } from '@/server/chat';
import { getDatabase } from '@/server/database';
import { apiRoute } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A fresh token for the visitor's own visit, for the origin the page was opened on; the page asks for one before every connection. */
export const GET = apiRoute<{ token: string; id: string }>('door.chat', async (request, { token, id }) => Response.json(await visitorChatAccess(await getDatabase(), token, id, { pageOrigin: request.nextUrl.origin })));
