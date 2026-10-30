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

/** Sends a test only to the devices of the resident who asked for it, among the ones of this home. */
export const POST = apiRoute('test-my-devices', async (request) => {
  const user = await requireIdentity();
  const input = await readJson(request, z.object({ home: homeIdSchema }));
  const member = await requireHome(user, input.home);
  const database = await getDatabase();
  const home = await getHome(database, member.homeId);
  const result = await sendPush(database, { kind: 'test', homeId: home.id, title: `${home.name}: tu timbre está listo`, body: 'Esta es una notificación de prueba de Ringgg.', residentEmail: member.email });
  if (!result.total) throw new AppError(HTTP.conflict, 'NO_DEVICES', 'Todavía no conectaste ningún celular a esta casa. Activá las notificaciones en este dispositivo.');
  if (!result.accepted) throw new AppError(HTTP.unavailable, 'TEST_FAILED', 'No pudimos enviar la prueba. Revisá los dispositivos de tu cuenta.');
  return Response.json({ accepted: result.accepted, total: result.total });
});
