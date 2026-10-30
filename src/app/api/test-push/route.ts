import { z } from 'zod';
import { HTTP } from '@/constants/doorbell';
import { requireAuth } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { AppError } from '@/server/errors';
import { apiRoute, readJson } from '@/server/http';
import { sendPush } from '@/server/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = apiRoute('test-push', async (request) => {
  await requireAuth();
  const input = await readJson(request, z.object({ id: z.uuid() }));
  const result = await sendPush(await getDatabase(), { title: 'Tu timbre está listo', body: 'Si recibiste este aviso, este celular ya puede recibir tu timbre.', deviceId: input.id });
  if (!result.accepted) throw new AppError(HTTP.unavailable, 'TEST_FAILED', 'No se pudo enviar la prueba. Volvé a activar las notificaciones en este celular.');
  return Response.json({ ok: true });
});
