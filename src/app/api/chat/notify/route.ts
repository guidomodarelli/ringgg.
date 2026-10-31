import { CHAT_HEADERS } from '@/constants/chat';
import { HTTP } from '@/constants/doorbell';
import { notifyChatMessage } from '@/server/chat';
import { getDatabase } from '@/server/database';
import { apiRoute, readText } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Called by the chat Worker, never by a browser: there is no Origin to check, and the HMAC signature
 * over the body and its timestamp is what authenticates it.
 */
export const POST = apiRoute('chat.notify', async (request) => {
  const body = await readText(request);
  await notifyChatMessage(await getDatabase(), { body, timestamp: request.headers.get(CHAT_HEADERS.timestamp), signature: request.headers.get(CHAT_HEADERS.signature) });
  return new Response(null, { status: HTTP.noContent });
}, { checkOrigin: false });
