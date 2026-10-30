import { z } from 'zod';
import { HOMES } from '@/constants/homes';
import { requireHome, requireIdentity } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { homeIdSchema } from '@/server/homes';
import { apiRoute, readJson } from '@/server/http';
import { addResident, listResidents, removeResident, renameResident } from '@/server/residents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const residentSchema = z.discriminatedUnion('action', [
  z.object({ home: homeIdSchema, action: z.literal('add'), email: z.string() }),
  z.object({ home: homeIdSchema, action: z.literal('remove'), email: z.string() }),
  z.object({ home: homeIdSchema, action: z.literal('rename'), email: z.string(), name: z.string() }),
]);

/** `?home=<id>`: the residents of one home, with the names that home uses for them. */
export const GET = apiRoute('residents', async (request) => {
  const user = await requireIdentity();
  const member = await requireHome(user, homeIdSchema.parse(request.nextUrl.searchParams.get(HOMES.queryParameter)));
  return Response.json({ residents: await listResidents(await getDatabase(), member.homeId) });
});

/** Shared management inside one home: any resident adds, removes or renames residents of that home. */
export const POST = apiRoute('residents', async (request) => {
  const user = await requireIdentity();
  const input = await readJson(request, residentSchema);
  const member = await requireHome(user, input.home);
  const database = await getDatabase();
  const target = { homeId: member.homeId, email: input.email };
  if (input.action === 'add') await addResident(database, member, target);
  else if (input.action === 'rename') await renameResident(database, member, { ...target, name: input.name });
  else {
    await removeResident(database, member, target);
    if (input.email.trim().toLowerCase() === member.email.trim().toLowerCase()) return Response.json({ removedSelf: true });
  }
  return Response.json({ residents: await listResidents(database, member.homeId) });
});
