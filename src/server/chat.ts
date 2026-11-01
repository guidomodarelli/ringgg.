import { z } from 'zod';
import { CHAT, CHAT_HEADERS, CHAT_PATHS, CHAT_REJECTIONS } from '@/constants/chat';
import { HTTP } from '@/constants/doorbell';
import { TIME } from '@/constants/time';
import { chatAnswerUrl, chatSocketUrl, isVisitId, signAnswerAnnouncement, signChatToken, verifyNotification, type ChatAccess, type ChatAnswerAnnouncement, type ChatClaims, type ChatNotification, type SignedChatRequest } from '@/lib/chat-protocol';
import type { ResidentIdentity } from '@/types/auth';
import type { DeliveryStatus, Visit } from '@/types/doorbell';
import type { Environment } from '@/types/environment';
import type { ResidentSettings } from '@/types/residents';
import { getConfig } from './config';
import type { Database } from './database';
import { getHome, readVisit } from './doorbell';
import { AppError, logError } from './errors';
import { parseJson } from './json';
import { sendPush } from './push';
import { memberName, residentSettings, resolveHomeAccess } from './residents';

/**
 * Where the chat Worker runs, the secret both sides sign with, this app's canonical origin, which names
 * the rooms, and the origins its pages answer on, which may open sockets.
 */
export interface ChatSettings { url: string; secret: string; origin: string; allowedOrigins: string[] }

/** `null` when this deployment has no chat: without `CHAT_URL` and a long enough `CHAT_SECRET`, the note stays. */
export function chatSettings(env: Environment = process.env): ChatSettings | null {
  const url = env.CHAT_URL?.trim().replace(/\/$/, '');
  const secret = env.CHAT_SECRET ?? '';
  if (!url || secret.length < CHAT.secretMinimumLength) return null;
  const { origin, allowedOrigins } = getConfig(env);
  return { url, secret, origin, allowedOrigins };
}

function requireChat(settings: ChatSettings | null): ChatSettings {
  if (!settings) throw new AppError(HTTP.notFound, 'CHAT_UNAVAILABLE', 'El chat no está disponible en este timbre.');
  return settings;
}

function visitNotFound() {
  return new AppError(HTTP.notFound, 'VISIT_NOT_FOUND', 'Ese timbrazo ya no está en el historial.');
}

/** The chat of a visit takes messages from the ring until the window ends. */
function closingTime(createdAt: string | Date) {
  return new Date(createdAt).getTime() + CHAT.windowSeconds * TIME.secondMs;
}

/** The page that asked, when it is one of the app's own origins; any other one gets the canonical origin, which its socket cannot use. */
function socketOrigin(settings: ChatSettings, pageOrigin: string | undefined) {
  return pageOrigin && settings.allowedOrigins.includes(pageOrigin) ? pageOrigin : settings.origin;
}

type IssuedClaims = Omit<ChatClaims, 'origin' | 'pageOrigin' | 'expiresAt'>;

async function issueAccess(settings: ChatSettings, claims: IssuedClaims, { now, pageOrigin }: { now: number; pageOrigin?: string }): Promise<ChatAccess> {
  const token = await signChatToken({ ...claims, origin: settings.origin, pageOrigin: socketOrigin(settings, pageOrigin), expiresAt: now + CHAT.tokenTtlSeconds * TIME.secondMs }, settings.secret);
  return { url: chatSocketUrl(settings.url, claims.visitId), token, closesAt: claims.closesAt, role: claims.role, name: claims.name };
}

/**
 * The deployment's chat, its bootstrap residents, the current time and the origin of the page asking
 * (the route's own URL); tests pass their own.
 */
interface ChatContext { settings?: ChatSettings | null; residents?: ResidentSettings; now?: number; pageOrigin?: string }

/**
 * The visitor opens the chat with what only they have: the QR token and the id of the visit they rang
 * with. Once the chat closes they get no token, so the visitor never reads replies after the window.
 */
export async function visitorChatAccess(database: Database, token: string, visitId: string, { settings = chatSettings(), now = Date.now(), pageOrigin }: ChatContext = {}): Promise<ChatAccess> {
  const chat = requireChat(settings);
  if (!isVisitId(visitId)) throw visitNotFound();
  const visit = await readVisit(database, token, visitId);
  const closesAt = closingTime(visit.created_at);
  if (now >= closesAt) throw new AppError(HTTP.conflict, 'CHAT_CLOSED', CHAT_REJECTIONS.CHAT_CLOSED);
  return issueAccess(chat, { visitId, role: 'visitor', name: null, closesAt }, { now, pageOrigin });
}

/** The home and ring time of a visit, or `null` when it is no longer in the history. */
async function visitTiming(database: Database, visitId: string) {
  if (!isVisitId(visitId)) return null;
  const [visit] = (await database.query<{ home_id: number; created_at: string | Date }>('SELECT home_id, created_at FROM visits WHERE id = $1', [visitId])).rows;
  return visit ? { homeId: visit.home_id, closesAt: closingTime(visit.created_at) } : null;
}

/**
 * A resident of the visit's home joins under the name that home uses for them. They can read the
 * conversation while the visit stays in the history; the room itself rejects messages after it closes.
 */
export async function residentChatAccess(database: Database, user: ResidentIdentity, visitId: string, { settings = chatSettings(), residents = residentSettings(), now = Date.now(), pageOrigin }: ChatContext = {}): Promise<ChatAccess> {
  const chat = requireChat(settings);
  const visit = await visitTiming(database, visitId);
  if (!visit) throw visitNotFound();
  const member = await resolveHomeAccess(database, user, visit.homeId, residents);
  return issueAccess(chat, { visitId, role: 'resident', name: memberName(member), closesAt: visit.closesAt }, { now, pageOrigin });
}

const notificationSchema = z.object({
  visitId: z.uuid(),
  messageId: z.uuid(),
  body: z.string().trim().min(1).max(CHAT.messageMaxLength),
}) satisfies z.ZodType<ChatNotification>;

/**
 * The Worker asks for a notification when the visitor writes and no resident has the chat open. Only
 * a recent request signed with the shared secret, for a visit whose chat is still open, notifies the
 * residents' devices; the notification opens that visit in the history.
 */
export async function notifyChatMessage(database: Database, request: SignedChatRequest,{ settings = chatSettings(), now = Date.now() }: ChatContext = {}): Promise<{ delivery: DeliveryStatus }> {
  const chat = requireChat(settings);
  if (!(await verifyNotification(request, chat.secret, now))) throw new AppError(HTTP.unauthorized, 'CHAT_SIGNATURE', 'La firma del aviso del chat no es válida.');
  const notification = parseJson(request.body, notificationSchema);
  const visit = await visitTiming(database, notification.visitId);
  if (!visit) throw visitNotFound();
  if (now >= visit.closesAt) throw new AppError(HTTP.conflict, 'CHAT_CLOSED', CHAT_REJECTIONS.CHAT_CLOSED);
  const home = await getHome(database, visit.homeId);
  const outcome = await sendPush(database, { kind: 'chat', homeId: home.id, title: `${home.name}: la visita te escribió`, body: notification.body.slice(0, CHAT.notificationBodyMaxLength), visitId: notification.visitId });
  return { delivery: outcome.delivery };
}

/** The answered visit the room is told about: what the visitor's page needs and when its chat closes. */
type AnsweredVisit = Pick<Visit, 'id' | 'created_at' | 'answered_at' | 'reply'>;

/**
 * Tells the visit's room that the residents answered, so the visitor's page shows it at once through its
 * chat socket instead of on its next poll. The request is signed with the shared secret and its time, as
 * an answer, so the Worker rejects forged and replayed ones. Repeating it is harmless: the room keeps the
 * first answer, like the database. A failure is logged and dropped, because the answer is already stored
 * and the visitor's poll still brings it.
 */
export async function announceAnswer(visit: AnsweredVisit, { settings = chatSettings() }: Pick<ChatContext, 'settings'> = {}) {
  if (!settings || !visit.answered_at || !visit.reply) return;
  const body = JSON.stringify({
    visitId: visit.id, origin: settings.origin, closesAt: closingTime(visit.created_at),
    answer: { reply: visit.reply, answeredAt: new Date(visit.answered_at).toISOString() },
  } satisfies ChatAnswerAnnouncement);
  const timestamp = Math.floor(Date.now() / TIME.secondMs);
  const context = { visitId: visit.id, method: 'POST', path: `${CHAT_PATHS.socket}<visitId>${CHAT_PATHS.answer}` };
  try {
    const response = await fetch(chatAnswerUrl(settings.url, visit.id), {
      method: 'POST', body, signal: AbortSignal.timeout(CHAT.announceTimeoutMs),
      headers: { 'Content-Type': 'application/json', [CHAT_HEADERS.timestamp]: String(timestamp), [CHAT_HEADERS.signature]: await signAnswerAnnouncement(body, timestamp, settings.secret) },
    });
    if (!response.ok) logError('chat.announceAnswer', new Error(`Chat Worker rejected the answer with HTTP ${response.status}`), { ...context, status: response.status, requestId: response.headers.get('cf-ray') });
  } catch (error) {
    logError('chat.announceAnswer', error, context);
  }
}
