'use client';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { CHAT } from '@/constants/chat';
import { chatSocketProtocols, parseServerChatMessage, type ChatAccess, type ServerChatMessage } from '@/lib/chat-protocol';

interface ChatConnectionOptions {
  socketRef: RefObject<WebSocket | null>;
  /** Asks the app for a fresh token; called before every connection. */
  requestAccess: (signal: AbortSignal) => Promise<ChatAccess>;
  /** Whether a socket should be open now; turning it off closes the current one. */
  active: boolean;
  onAccess: (access: ChatAccess) => void;
  onMessage: (message: ServerChatMessage) => void;
}

const NORMAL_CLOSURE = 1000;

/**
 * One socket at a time to the visit's room. A dropped socket or a failed token request is retried with
 * a growing delay; the room's history means the connection is live again. Callbacks are read from refs,
 * so a new render never reopens the socket.
 */
export function useChatConnection({ socketRef, requestAccess, active, onAccess, onMessage }: ChatConnectionOptions) {
  const [connected, setConnected] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const failures = useRef(0);
  const callbacks = useRef({ requestAccess, onAccess, onMessage });
  useEffect(() => { callbacks.current = { requestAccess, onAccess, onMessage }; });

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const scheduleRetry = () => {
      if (disposed) return;
      setRetrying(true);
      const delay = Math.min(CHAT.reconnect.initialDelayMs * 2 ** failures.current, CHAT.reconnect.maxDelayMs);
      failures.current += 1;
      retryTimer = setTimeout(() => setAttempt((current) => current + 1), delay);
    };
    const receive = (data: unknown) => {
      const message = parseServerChatMessage(data);
      if (!message || disposed) return;
      if (message.type === 'history') { failures.current = 0; setConnected(true); setRetrying(false); setConnectionError(''); }
      callbacks.current.onMessage(message);
    };
    async function connect() {
      try {
        const access = await callbacks.current.requestAccess(controller.signal);
        if (disposed) return;
        callbacks.current.onAccess(access);
        const opened = new WebSocket(access.url, chatSocketProtocols(access.token));
        socket = opened;
        socketRef.current = opened;
        opened.addEventListener('message', (event) => receive(event.data));
        opened.addEventListener('close', () => {
          // A newer socket may already be live: only the current one reports the disconnection.
          if (socketRef.current !== opened && socketRef.current !== null) return;
          socketRef.current = null;
          setConnected(false);
          scheduleRetry();
        });
      } catch (error) {
        if (disposed) return;
        setConnectionError(error instanceof Error ? error.message : 'No pudimos abrir el chat.');
        scheduleRetry();
      }
    }
    void connect();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(retryTimer);
      if (socketRef.current === socket) socketRef.current = null;
      socket?.close(NORMAL_CLOSURE);
    };
  }, [attempt, active, socketRef]);

  /** Tries again now instead of waiting for the scheduled attempt. */
  const reconnect = useCallback(() => { failures.current = 0; setAttempt((current) => current + 1); }, []);
  return { connected, retrying, connectionError, reconnect };
}
