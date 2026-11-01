import { CHAT_HEADERS, CHAT_PATHS } from '../../src/constants/chat';
import { HTTP } from '../../src/constants/doorbell';
import { chatRoomName, isVisitId, parseAnswerAnnouncement, tokenFromProtocols, verifyAnswerAnnouncement, verifyChatToken } from '../../src/lib/chat-protocol';
import { CLAIMS_HEADER, type ChatEnv } from './env';

export { ChatRoom } from './chat-room';

function plain(text: string, status: number) {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/** `/visits/<id>` (the room's socket) or `/visits/<id>/answer` (the app's announcement), or `null` for any other path. */
function roomRoute(pathname: string): { visitId: string; target: 'socket' | 'answer' } | null {
  if (!pathname.startsWith(CHAT_PATHS.socket)) return null;
  const rest = pathname.slice(CHAT_PATHS.socket.length);
  const answer = rest.endsWith(CHAT_PATHS.answer);
  const visitId = decodeURIComponent(answer ? rest.slice(0, -CHAT_PATHS.answer.length) : rest);
  return isVisitId(visitId) ? { visitId, target: answer ? 'answer' : 'socket' } : null;
}

function roomOf(env: ChatEnv, origin: string, visitId: string) {
  return env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName(chatRoomName(origin, visitId)));
}

/**
 * Upgrades to the room of a visit once the token in `Sec-WebSocket-Protocol` checks out: signed by the
 * app, unexpired, for this visit and used from the page it was issued to. Only then does the request
 * reach the room, with the verified claims.
 */
async function openSocket(request: Request, env: ChatEnv, visitId: string) {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return plain('Expected a WebSocket upgrade', HTTP.upgradeRequired);
  const token = tokenFromProtocols(request.headers.get('Sec-WebSocket-Protocol'));
  const claims = token ? await verifyChatToken(token, env.CHAT_SECRET) : null;
  if (claims?.visitId !== visitId || request.headers.get('Origin') !== claims.pageOrigin) return plain('Unauthorized', HTTP.unauthorized);
  const headers = new Headers(request.headers);
  headers.set(CLAIMS_HEADER, JSON.stringify(claims));
  return roomOf(env, claims.origin, visitId).fetch(new Request(request, { headers }));
}

/**
 * The app tells the room that the residents answered. Only a recent request signed with the shared
 * secret, as an answer and for this visit, reaches the room; the room then tells its sockets.
 */
async function announceAnswer(request: Request, env: ChatEnv, visitId: string) {
  if (request.method !== 'POST') return plain('Expected POST', HTTP.methodNotAllowed);
  const body = await request.text();
  const signed = { body, timestamp: request.headers.get(CHAT_HEADERS.timestamp), signature: request.headers.get(CHAT_HEADERS.signature) };
  if (!(await verifyAnswerAnnouncement(signed, env.CHAT_SECRET))) return plain('Unauthorized', HTTP.unauthorized);
  const announcement = parseAnswerAnnouncement(body);
  if (announcement?.visitId !== visitId) return plain('Invalid answer', HTTP.badRequest);
  await roomOf(env, announcement.origin, visitId).recordAnswer(announcement);
  return new Response(null, { status: HTTP.noContent });
}

/**
 * Entry point of the chat Worker: the sockets of each visit's room and the app's announcements of the
 * residents' answers. Rooms are named after the app's canonical origin, so every page of a deployment
 * shares them.
 */
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === CHAT_PATHS.health) return plain('ok', HTTP.ok);
    const route = roomRoute(pathname);
    if (!route) return plain('Not found', HTTP.notFound);
    return route.target === 'answer' ? announceAnswer(request, env, route.visitId) : openSocket(request, env, route.visitId);
  },
} satisfies ExportedHandler<ChatEnv>;
