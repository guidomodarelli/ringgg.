import { DurableObject } from 'cloudflare:workers';
import { CHAT } from '../../src/constants/chat';
import { HTTP } from '../../src/constants/doorbell';
import { TIME } from '../../src/constants/time';
import { messageFor, parseClientChatMessage, type ChatClaims, type ChatMessage, type ChatRole, type ServerChatMessage } from '../../src/lib/chat-protocol';
import { CLAIMS_HEADER, type ChatEnv } from './env';
import { notifyResidents } from './notify';
import { RoomStore, type RoomState } from './room-store';

/** What each socket remembers across hibernation: who holds it. */
interface SocketIdentity { role: ChatRole; name: string | null }

const NORMAL_CLOSURE = 1000;

function send(socket: WebSocket, message: ServerChatMessage) {
  socket.send(JSON.stringify(message));
}

/**
 * The chat of one visit. It uses the WebSocket Hibernation API: while nobody writes, the object
 * sleeps and Cloudflare does not bill its duration. Messages live in the object's own SQLite until
 * the visit leaves the history; then an alarm closes the sockets and erases the room.
 */
export class ChatRoom extends DurableObject<ChatEnv> {
  private readonly store: RoomStore;

  constructor(context: DurableObjectState, env: ChatEnv) {
    super(context, env);
    this.store = new RoomStore(context.storage.sql);
  }

  /** Opens a socket for claims the Worker already verified; only the Worker can reach this object. */
  override async fetch(request: Request) {
    const claims = JSON.parse(request.headers.get(CLAIMS_HEADER) ?? 'null') as ChatClaims;
    const room = this.store.open(claims);
    await this.scheduleErasure(room);
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [claims.role]);
    server.serializeAttachment({ role: claims.role, name: claims.name } satisfies SocketIdentity);
    send(server, { type: 'history', messages: this.store.messages().map((message) => messageFor(message, claims.role)), closesAt: room.closesAt });
    return new Response(null, { status: HTTP.switchingProtocols, webSocket: client, headers: { 'Sec-WebSocket-Protocol': CHAT.protocol } });
  }

  override async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    const identity = socket.deserializeAttachment() as SocketIdentity;
    const input = typeof raw === 'string' ? parseClientChatMessage(raw) : null;
    if (!input) { send(socket, { type: 'rejected', id: '', code: 'MESSAGE_INVALID' }); return; }
    const room = this.store.room();
    const now = Date.now();
    if (!room || now >= room.closesAt) { send(socket, { type: 'rejected', id: input.id, code: 'CHAT_CLOSED' }); return; }
    const outcome = this.store.append({ id: input.id, author: identity.role, name: identity.name, body: input.body, sentAt: now });
    if (outcome.status === 'full') { send(socket, { type: 'rejected', id: input.id, code: 'ROOM_FULL' }); return; }
    // A retry of a message already stored only confirms it to the socket that sent it again.
    if (outcome.status === 'duplicate') { send(socket, { type: 'message', message: messageFor(outcome.message, identity.role) }); return; }
    this.broadcast(outcome.message);
    if (identity.role === 'visitor') await this.notifyIfNobodyIsReading(room, outcome.message, now);
  }

  /** Completes the closing handshake the client started. */
  override async webSocketClose(socket: WebSocket, code: number, reason: string) {
    socket.close(code, reason);
  }

  /** The visit left the history: nobody can open its chat again, so the room is erased. */
  override async alarm() {
    for (const socket of this.ctx.getWebSockets()) socket.close(NORMAL_CLOSURE, 'El chat de esta visita ya no está disponible.');
    await this.ctx.storage.deleteAll();
  }

  private broadcast(message: ChatMessage) {
    for (const socket of this.ctx.getWebSockets()) {
      const { role } = socket.deserializeAttachment() as SocketIdentity;
      send(socket, { type: 'message', message: messageFor(message, role) });
    }
  }

  /** The residents get a notification when none of them has the chat open, at most once per cooldown. */
  private async notifyIfNobodyIsReading(room: RoomState, message: ChatMessage, now: number) {
    if (this.ctx.getWebSockets('resident').length > 0 || !this.store.claimNotification(now)) return;
    await notifyResidents(room, message, this.env.CHAT_SECRET);
  }

  private async scheduleErasure(room: RoomState) {
    if (await this.ctx.storage.getAlarm() !== null) return;
    await this.ctx.storage.setAlarm(room.closesAt + CHAT.retentionDays * TIME.dayMs);
  }
}
