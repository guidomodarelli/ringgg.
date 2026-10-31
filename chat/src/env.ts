import type { ChatRoom } from './chat-room';

/** Bindings of the chat Worker: the visit rooms and the secret it shares with the app (`wrangler secret put CHAT_SECRET`). */
export interface ChatEnv { CHAT_ROOMS: DurableObjectNamespace<ChatRoom>; CHAT_SECRET: string }

/** Internal header: the Worker hands the verified claims to the room. Clients never reach the room directly. */
export const CLAIMS_HEADER = 'x-ringgg-chat-claims';
