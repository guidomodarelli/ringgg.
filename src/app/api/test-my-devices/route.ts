import { HTTP } from '@/constants/doorbell';
import { requireAuth } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { AppError } from '@/server/errors';
import { apiRoute } from '@/server/http';
import { sendPush } from '@/server/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = apiRoute('test-my-devices', async () => {
  const user = await requireAuth();
  const result = await sendPush(await getDatabase(), { title: 'Tu timbre está listo', body: 'Esta es una notificación de prueba de Ringgg.', residentEmail: user.email });
  if (!result.accepted) throw new AppError(HTTP.unavailable, 'TEST_FAILED', 'No pudimos enviar la prueba. Revisá los dispositivos de tu cuenta.');
  return Response.json({ accepted: result.accepted, total: result.total });
});
