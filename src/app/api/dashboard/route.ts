import { HOMES } from '@/constants/homes';
import { requireHome, requireIdentity } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { snapshot } from '@/server/doorbell';
import { homeIdSchema } from '@/server/homes';
import { apiRoute } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `?home=<id>`: the snapshot of one home the resident belongs to. */
export const GET = apiRoute('dashboard', async (request) => {
  const user = await requireIdentity();
  const member = await requireHome(user, homeIdSchema.parse(request.nextUrl.searchParams.get(HOMES.queryParameter)));
  return Response.json(await snapshot(await getDatabase(), member.homeId));
});
