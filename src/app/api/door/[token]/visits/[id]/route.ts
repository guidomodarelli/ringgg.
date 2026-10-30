import { getDatabase } from '@/server/database';
import { readVisit } from '@/server/doorbell';
import { apiRoute } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiRoute<{ token: string; id: string }>('door.visit', async (_request, { token, id }) => Response.json(await readVisit(await getDatabase(), token, id)));
