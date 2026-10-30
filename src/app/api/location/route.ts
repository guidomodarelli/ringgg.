import { z } from 'zod';
import { requireHome, requireIdentity } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { snapshot } from '@/server/doorbell';
import { homeIdSchema } from '@/server/homes';
import { apiRoute, readJson } from '@/server/http';
import { clearHomeLocation, positionSchema, setHomeLocation, setNearbyOnly } from '@/server/location';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const locationSchema = z.discriminatedUnion('action', [
  z.object({ home: homeIdSchema, action: z.literal('set'), position: positionSchema }),
  z.object({ home: homeIdSchema, action: z.literal('clear') }),
  z.object({ home: homeIdSchema, action: z.literal('nearby'), enabled: z.boolean() }),
]);

/** Where the door is and whether visitors must be near it; answers with the snapshot so the panel reconciles. */
export const POST = apiRoute('location', async (request) => {
  const user = await requireIdentity();
  const input = await readJson(request, locationSchema);
  const member = await requireHome(user, input.home);
  const database = await getDatabase();
  if (input.action === 'set') await setHomeLocation(database, member.homeId, input.position);
  else if (input.action === 'clear') await clearHomeLocation(database, member.homeId);
  else await setNearbyOnly(database, member.homeId, input.enabled);
  return Response.json(await snapshot(database, member.homeId));
});
