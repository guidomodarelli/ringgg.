import { getDatabase } from '@/server/database';
import { followVisit } from '@/server/doorbell';
import { apiRoute } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The visitor's poll: it reads the visit and sends a ring that its failed request left without a notice. */
export const GET = apiRoute<{ token: string; id: string }>('door.visit', async (_request, { token, id }) => Response.json(await followVisit(await getDatabase(), token, id)));
