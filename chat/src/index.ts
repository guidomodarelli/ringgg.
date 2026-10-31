import { CHAT_PATHS } from '../../src/constants/chat';
import { HTTP } from '../../src/constants/doorbell';
import { chatRoomName, isVisitId, tokenFromProtocols, verifyChatToken } from '../../src/lib/chat-protocol';
import { CLAIMS_HEADER, type ChatEnv } from './env';

export { ChatRoom } from './chat-room';

function plain(text: string, status: number) {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/**
 * Entry point of the chat Worker. `GET /visits/<id>` upgrades to the room of that visit once the token
 * in `Sec-WebSocket-Protocol` checks out: signed by the app, unexpired, for this visit and used from
 * the page it was issued to. Only then does the request reach the room, with the verified claims. The
 * room is named after the app's canonical origin, so every page of a deployment shares it.
 */
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === CHAT_PATHS.health) return plain('ok', HTTP.ok);
    const visitId = pathname.startsWith(CHAT_PATHS.socket) ? decodeURIComponent(pathname.slice(CHAT_PATHS.socket.length)) : '';
    if (!isVisitId(visitId)) return plain('Not found', HTTP.notFound);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return plain('Expected a WebSocket upgrade', HTTP.upgradeRequired);
    const token = tokenFromProtocols(request.headers.get('Sec-WebSocket-Protocol'));
    const claims = token ? await verifyChatToken(token, env.CHAT_SECRET) : null;
    if (claims?.visitId !== visitId || request.headers.get('Origin') !== claims.pageOrigin) return plain('Unauthorized', HTTP.unauthorized);
    const headers = new Headers(request.headers);
    headers.set(CLAIMS_HEADER, JSON.stringify(claims));
    const room = env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName(chatRoomName(claims.origin, visitId)));
    return room.fetch(new Request(request, { headers }));
  },
} satisfies ExportedHandler<ChatEnv>;
