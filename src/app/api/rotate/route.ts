import { z } from 'zod';
import { requireHome, requireIdentity } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { rotateToken, snapshot } from '@/server/doorbell';
import { homeIdSchema } from '@/server/homes';
import { apiRoute, readJson } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A new QR for this home only: its previous token stops working right away. */
export const POST = apiRoute('rotate', async (request) => {
  const user = await requireIdentity();
  const input = await readJson(request, z.object({ home: homeIdSchema }));
  const member = await requireHome(user, input.home);
  const database = await getDatabase();
  await rotateToken(database, member.homeId);
  return Response.json(await snapshot(database, member.homeId));
});
