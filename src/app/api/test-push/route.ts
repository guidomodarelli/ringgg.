import { z } from 'zod';
import { HTTP } from '@/constants/doorbell';
import { requireHome, requireIdentity } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { getHome } from '@/server/doorbell';
import { AppError } from '@/server/errors';
import { homeIdSchema } from '@/server/homes';
import { apiRoute, readJson } from '@/server/http';
import { sendPush } from '@/server/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = apiRoute('test-push', async (request) => {
  const user = await requireIdentity();
  const input = await readJson(request, z.object({ home: homeIdSchema, id: z.uuid() }));
  const member = await requireHome(user, input.home);
  const database = await getDatabase();
  const home = await getHome(database, member.homeId);
  const result = await sendPush(database, { kind: 'test', homeId: home.id, title: `${home.name}: tu timbre está listo`, body: 'Si recibiste este aviso, este celular ya puede recibir tu timbre.', deviceId: input.id });
  if (!result.accepted) throw new AppError(HTTP.unavailable, 'TEST_FAILED', 'No se pudo enviar la prueba. Volvé a activar las notificaciones en este celular.');
  return Response.json({ ok: true });
});
