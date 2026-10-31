'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CHAT, CHAT_REJECTIONS } from '@/constants/chat';
import type { ChatAccess, ChatMessage, ChatRole, ServerChatMessage } from '@/lib/chat-protocol';
import { useChatConnection } from './use-chat-connection';
import { useChatOutbox } from './use-chat-outbox';

/**
 * - `connecting`: asking for a token and opening the socket the first time.
 * - `open`: the room is live and takes messages.
 * - `reconnecting`: the socket dropped, or the token request failed, and a new attempt is scheduled.
 * - `paused`: the page, or the section that holds the chat, is hidden; its socket is closed so a chat nobody sees does not count as reading.
 * - `closed`: the chat no longer takes messages; what was said stays readable.
 */
export type ChatStatus = 'connecting' | 'open' | 'reconnecting' | 'paused' | 'closed';

/** A message of the thread: confirmed by the room, still on its way, or not confirmed. */
export interface ThreadMessage extends ChatMessage { own: boolean; delivery: 'sent' | 'sending' | 'failed'; failure: string }

interface ChatViewer { role: ChatRole; name: string | null }

interface VisitChatOptions {
  requestAccess: (signal: AbortSignal) => Promise<ChatAccess>;
  /** When the chat closes, if the page already knows it. */
  knownClosesAt?: number;
  /** Whether a chat that already ended still connects once to show what was said (residents) or not at all (the visitor). */
  historyAfterEnd?: boolean;
  /** `false` while the chat is mounted but out of sight; like a hidden page, it closes the socket. */
  onScreen?: boolean;
}

function isOwn(message: ChatMessage, viewer: ChatViewer | null) {
  return viewer !== null && message.author === viewer.role && (viewer.role === 'visitor' || message.name === viewer.name);
}

/** Inserts or replaces a confirmed message, keeping the room's order. */
function withMessage(messages: ChatMessage[], message: ChatMessage) {
  return [...messages.filter((existing) => existing.id !== message.id), message].sort((first, second) => first.sentAt - second.sentAt);
}

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

/** A hidden page closes its socket and opens a new one when it comes back. */
function usePageVisible() {
  return useSyncExternalStore(subscribeToVisibility, () => document.visibilityState !== 'hidden', () => true);
}

function chatStatus({ ended, visible, connected, retrying, loaded }: { ended: boolean; visible: boolean; connected: boolean; retrying: boolean; loaded: boolean }): ChatStatus {
  if (ended) return 'closed';
  if (!visible) return 'paused';
  if (connected) return 'open';
  return retrying || loaded ? 'reconnecting' : 'connecting';
}

/**
 * The live chat of one visit. Sending is optimistic: the message shows in the thread right away as
 * «Enviando…» and the room's broadcast confirms it. The chat ends at its time even if the room says
 * nothing: the composer goes away, the socket closes and what was still on its way is marked as not sent.
 * A chat that ended while its socket was closed reads the history once more, so it never shows half a conversation as the whole one.
 */
export function useVisitChat({ requestAccess, knownClosesAt, historyAfterEnd = true, onScreen = true }: VisitChatOptions) {
  const socketRef = useRef<WebSocket | null>(null);
  const { outgoing, add, retry, discard, confirm, markFailed, resendWaiting, failWaiting } = useChatOutbox(socketRef);
  const [confirmed, setConfirmed] = useState<ChatMessage[]>([]);
  const [viewer, setViewer] = useState<ChatViewer | null>(null);
  const [closesAt, setClosesAt] = useState<number | null>(knownClosesAt ?? null);
  const [ended, setEnded] = useState(() => knownClosesAt !== undefined && Date.now() >= knownClosesAt);
  const [loaded, setLoaded] = useState(false);
  // The thread holds everything said until the end: read after it, or live through it.
  const [complete, setComplete] = useState(false);
  const connectedRef = useRef(false);
  const visible = usePageVisible() && onScreen;

  const endChat = useCallback(() => {
    setEnded(true);
    if (connectedRef.current) setComplete(true);
    failWaiting(CHAT_REJECTIONS.CHAT_CLOSED);
  }, [failWaiting]);

  const receive = useCallback((message: ServerChatMessage) => {
    if (message.type === 'history') {
      setLoaded(true);
      setConfirmed(message.messages);
      setClosesAt(message.closesAt);
      confirm(new Set(message.messages.map((stored) => stored.id)));
      if (Date.now() >= message.closesAt) { setComplete(true); endChat(); } else resendWaiting();
    } else if (message.type === 'message') {
      setConfirmed((messages) => withMessage(messages, message.message));
      confirm(new Set([message.message.id]));
    } else {
      if (message.id) markFailed([message.id], CHAT_REJECTIONS[message.code]);
      if (message.code === 'CHAT_CLOSED') endChat();
    }
  }, [confirm, endChat, markFailed, resendWaiting]);

  const onAccess = useCallback((access: ChatAccess) => { setViewer({ role: access.role, name: access.name }); setClosesAt(access.closesAt); }, []);
  // An ended chat only connects to read what was said, and lets the socket go once it has all of it.
  const connection = useChatConnection({ socketRef, requestAccess, active: visible && (!ended || (historyAfterEnd && !complete)), onAccess, onMessage: receive });
  useEffect(() => { connectedRef.current = connection.connected; }, [connection.connected]);

  useEffect(() => {
    if (closesAt === null || ended) return;
    const timer = setTimeout(endChat, Math.max(0, closesAt - Date.now()));
    return () => clearTimeout(timer);
  }, [closesAt, ended, endChat]);

  const send = useCallback((body: string) => {
    const text = body.trim();
    if (!text || text.length > CHAT.messageMaxLength || ended) return false;
    add(text);
    return true;
  }, [ended, add]);

  const thread: ThreadMessage[] = [
    ...confirmed.map((message): ThreadMessage => ({ ...message, own: isOwn(message, viewer), delivery: 'sent', failure: '' })),
    ...outgoing.map((message): ThreadMessage => ({ ...message, author: viewer?.role ?? 'visitor', name: viewer?.name ?? null, own: true })),
  ];
  const status = chatStatus({ ended, visible, loaded, connected: connection.connected, retrying: connection.retrying });
  return { status, thread, loaded, connectionError: connection.connectionError, send, retry, discard, reconnect: connection.reconnect };
}
