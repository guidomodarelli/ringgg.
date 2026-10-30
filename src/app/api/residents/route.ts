import { z } from 'zod';
import { requireAuth } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { apiRoute, readJson } from '@/server/http';
import { addResident, listResidents, removeResident } from '@/server/residents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const residentSchema = z.object({ email: z.string(), action: z.enum(['add', 'remove']) });

export const GET = apiRoute('residents', async () => {
  const user = await requireAuth();
  return Response.json({ residents: await listResidents(await getDatabase(), user) });
});

export const POST = apiRoute('residents', async (request) => {
  const user = await requireAuth();
  const input = await readJson(request, residentSchema);
  const database = await getDatabase();
  if (input.action === 'add') await addResident(database, user, input.email);
  else {
    await removeResident(database, user, input.email);
    if (input.email.trim().toLowerCase() === user.email.trim().toLowerCase()) return Response.json({ removedSelf: true });
  }
  return Response.json({ residents: await listResidents(database, user) });
});
