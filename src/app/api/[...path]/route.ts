import { NextRequest } from 'next/server';
import { z } from 'zod';
import { DOORBELL, HTTP } from '@/constants/doorbell';
import { requireAuth, requireOrigin } from '@/server/auth';
import { getDatabase } from '@/server/database';
import { getConfig } from '@/server/config';
import { snapshot, publicHome, registerVisit, readVisit, answerVisit, setDelivery } from '@/server/doorbell';
import { sendPush, saveDevice, subscriptionSchema } from '@/server/push';
import { AppError, errorResponse } from '@/server/errors';
import { addResident, listResidents, removeResident } from '@/server/residents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function body(request: Request) {
  const text = await request.text();
  if (text.length > 8192) throw new AppError(HTTP.badRequest, 'BODY_LIMIT', 'La solicitud es demasiado grande.');
  try { return JSON.parse(text); } catch (error) { throw new AppError(HTTP.badRequest, 'INVALID_JSON', 'La solicitud no tiene un formato válido.', { cause: error }); }
}

async function handle(request: NextRequest, path: string[]) {
  const route = path.join('/');
  const mutate = request.method === 'POST';
  if (mutate) requireOrigin(request);
  // Private data is opened only after authenticating and authorizing the resident.
  if (path[0] === 'door' && path[1]) {
    const database = await getDatabase();
    if (!mutate && path.length === 2) return Response.json(await publicHome(database, path[1]));
    if (!mutate && path[2] === 'visits' && path[3]) return Response.json(await readVisit(database, path[1], path[3]));
    if (mutate && path.length === 2) {
      const input = z.object({ id: z.uuid(), message: z.string().trim().max(DOORBELL.messageMaxLength) }).parse(await body(request));
      const result = await registerVisit(database, path[1], input.id, input.message);
      if (result.created) {
        const outcome = await sendPush(database, input.message, input.id);
        await setDelivery(database, input.id, outcome.delivery);
      }
      return Response.json(await readVisit(database, path[1], input.id));
    }
  }
  const user = await requireAuth();
  const database = await getDatabase();
  if (route === 'residents') {
    if (mutate) {
      const input = z.object({ email: z.string(), action: z.enum(['add', 'remove']) }).parse(await body(request));
      if (input.action === 'add') await addResident(database, user, input.email);
      else await removeResident(database, user, input.email);
    }
    return Response.json({ residents: await listResidents(database, user) });
  }
  if (route === 'push-key' && !mutate) return Response.json({ publicKey: getConfig().publicKey });
  if (route === 'dashboard' && !mutate) return Response.json(await snapshot(database));
  if (route === 'settings' && mutate) {
    const input = z.object({ name: z.string().trim().min(1).max(DOORBELL.nameMaxLength), enabled: z.boolean() }).parse(await body(request));
    await database.query('UPDATE homes SET name = $1, enabled = $2 WHERE id = 1', [input.name, input.enabled]);
    return Response.json(await snapshot(database));
  }
  if (route === 'rotate' && mutate) {
    await database.query('UPDATE homes SET token = $1 WHERE id = 1', [crypto.randomUUID()]);
    return Response.json(await snapshot(database));
  }
  if (route === 'answer' && mutate) {
    const input = z.object({ id: z.uuid() }).parse(await body(request));
    return Response.json(await answerVisit(database, input.id));
  }
  if (route === 'subscribe' && mutate) {
    const input = z.object({ name: z.string().trim().min(1).max(DOORBELL.nameMaxLength), subscription: subscriptionSchema }).parse(await body(request));
    await saveDevice(database, input.name, input.subscription, user);
    return Response.json({ ok: true });
  }
  if (route === 'remove-device' && mutate) {
    const input = z.object({ id: z.uuid() }).parse(await body(request));
    await database.query('DELETE FROM devices WHERE id = $1', [input.id]);
    return Response.json({ ok: true });
  }
  if (route === 'test-push' && mutate) {
    const input = z.object({ id: z.uuid() }).parse(await body(request));
    const result = await sendPush(database, 'Si recibiste este aviso, este celular ya puede recibir tu timbre.', undefined, input.id);
    if (!result.accepted) throw new AppError(HTTP.unavailable, 'TEST_FAILED', 'No se pudo enviar la prueba. Volvé a activar las notificaciones en este celular.');
    return Response.json({ ok: true });
  }
  throw new AppError(HTTP.notFound, 'ROUTE_NOT_FOUND', 'No encontramos esta operación.');
}

async function endpoint(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  try {
    const response = await handle(request, path);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Revisá los datos ingresados.', code: 'INVALID_INPUT' }, { status: HTTP.badRequest });
    return errorResponse(error, `${request.method} api.${path[0]}`);
  }
}
export const GET = endpoint;
export const POST = endpoint;
