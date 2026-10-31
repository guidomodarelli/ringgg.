'use client';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { CHAT } from '@/constants/chat';

/** A message written here that the room has not confirmed yet, or did not take. */
export interface OutgoingMessage { id: string; body: string; sentAt: number; delivery: 'sending' | 'failed'; failure: string }

const OPEN_SOCKET = 1;
const UNCONFIRMED_FAILURE = 'No pudimos confirmar el envío. Reintentá: no se va a duplicar.';

/**
 * Messages on their way. Each one carries an id chosen here, so sending it again (after a reconnection
 * or from «Reintentar») never posts it twice. A message the room does not confirm in time is marked as
 * unconfirmed instead of failed: it may have arrived, and the retry is safe either way.
 */
export function useChatOutbox(socketRef: RefObject<WebSocket | null>) {
  const [outgoing, setOutgoing] = useState<OutgoingMessage[]>([]);
  const outgoingRef = useRef<OutgoingMessage[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const update = useCallback((change: (messages: OutgoingMessage[]) => OutgoingMessage[]) => {
    outgoingRef.current = change(outgoingRef.current);
    setOutgoing(outgoingRef.current);
  }, []);

  const stopTimer = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const markFailed = useCallback((ids: string[], failure: string) => {
    for (const id of ids) stopTimer(id);
    update((messages) => messages.map((message) => ids.includes(message.id) ? { ...message, delivery: 'failed', failure } : message));
  }, [stopTimer, update]);

  /** Sends now when the socket is open; otherwise the message waits for {@link resendWaiting}. */
  const transmit = useCallback((message: OutgoingMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState !== OPEN_SOCKET) return;
    socket.send(JSON.stringify({ type: 'send', id: message.id, body: message.body }));
    stopTimer(message.id);
    timers.current.set(message.id, setTimeout(() => markFailed([message.id], UNCONFIRMED_FAILURE), CHAT.sendTimeoutMs));
  }, [markFailed, socketRef, stopTimer]);

  const add = useCallback((body: string) => {
    const message: OutgoingMessage = { id: crypto.randomUUID(), body, sentAt: Date.now(), delivery: 'sending', failure: '' };
    update((messages) => [...messages, message]);
    transmit(message);
  }, [transmit, update]);

  const retry = useCallback((id: string) => {
    const message = outgoingRef.current.find((candidate) => candidate.id === id);
    if (!message) return;
    const resent: OutgoingMessage = { ...message, delivery: 'sending', failure: '' };
    update((messages) => messages.map((candidate) => candidate.id === id ? resent : candidate));
    transmit(resent);
  }, [transmit, update]);

  /** The room has these messages: they leave the outbox and show as sent. */
  const confirm = useCallback((ids: ReadonlySet<string>) => {
    for (const id of ids) stopTimer(id);
    update((messages) => messages.filter((message) => !ids.has(message.id)));
  }, [stopTimer, update]);

  const discard = useCallback((id: string) => confirm(new Set([id])), [confirm]);

  /** After a reconnection: what was written meanwhile goes out in order, with the same ids. */
  const resendWaiting = useCallback(() => {
    for (const message of outgoingRef.current) if (message.delivery === 'sending') transmit(message);
  }, [transmit]);

  const failWaiting = useCallback((failure: string) => {
    markFailed(outgoingRef.current.filter((message) => message.delivery === 'sending').map((message) => message.id), failure);
  }, [markFailed]);

  useEffect(() => {
    const pendingTimers = timers.current;
    return () => { for (const timer of pendingTimers.values()) clearTimeout(timer); pendingTimers.clear(); };
  }, []);

  return { outgoing, add, retry, discard, confirm, markFailed, resendWaiting, failWaiting };
}
