'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDown, LoaderCircle, RefreshCw, SendHorizontal } from 'lucide-react';
import { CHAT } from '@/constants/chat';
import type { ChatAccess } from '@/lib/chat-protocol';
import { chatTime } from '@/lib/visit-format';
import { useVisitChat, type ChatStatus, type ThreadMessage } from './use-visit-chat';

type ViewerRole = 'visitor' | 'resident';

interface VisitChatProps {
  /** Heading of the panel, for example «Chat con Casa Modarelli». */
  title: string;
  /** Who reads this panel: the visitor sees residents as the home, residents see each other by name. */
  viewerRole: ViewerRole;
  homeName: string;
  requestAccess: (signal: AbortSignal) => Promise<ChatAccess>;
  knownClosesAt?: number;
  /** Shown while the thread is empty and the chat is open. */
  emptyText: string;
  /** Shown instead of the composer once the chat ended. */
  closedText: string;
  /** `false` while the panel is mounted but out of sight (another section of the dashboard): it lets its socket go. */
  onScreen?: boolean;
}

const STATUS_TEXT: Partial<Record<ChatStatus, string>> = {
  connecting: 'Conectando el chat…',
  reconnecting: 'Reconectando…',
  paused: 'El chat se reconecta cuando volvés a esta pestaña.',
};

/** Who wrote a message, as this reader sees it. */
function authorLabel(message: ThreadMessage, viewerRole: ViewerRole, homeName: string) {
  if (message.own) return 'Vos';
  if (message.author === 'visitor') return 'Visita';
  return viewerRole === 'visitor' ? homeName : message.name ?? 'Residente';
}

function MessageDelivery({ message, canRetry, onRetry, onDiscard }: { message: ThreadMessage; canRetry: boolean; onRetry: () => void; onDiscard: () => void }) {
  if (message.delivery === 'sending') return <span className="chat-delivery">Enviando…</span>;
  if (message.delivery === 'sent') return null;
  return <span className="chat-delivery failed">
    <span>No enviado. {message.failure}</span>
    {canRetry && <button type="button" className="text-button" onClick={onRetry}>Reintentar</button>}
    <button type="button" className="text-button" onClick={onDiscard}>Eliminar</button>
  </span>;
}

/**
 * Keeps the latest message in view while the reader is at the end of the thread. A reader who scrolled
 * up to reread is not moved: new messages show «Mensajes nuevos» instead.
 */
function useStickToLatest(count: number) {
  const listRef = useRef<HTMLOListElement | null>(null);
  const [atEnd, setAtEnd] = useState(true);
  const [seenCount, setSeenCount] = useState(0);
  useEffect(() => {
    const list = listRef.current;
    if (atEnd && list) list.scrollTop = list.scrollHeight;
  }, [count, atEnd]);
  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const end = list.scrollHeight - list.scrollTop - list.clientHeight <= CHAT.scrollStickinessPx;
    setAtEnd(end);
    if (end) setSeenCount(count);
  };
  const jumpToLatest = () => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
    setAtEnd(true);
    setSeenCount(count);
  };
  return { listRef, unseen: !atEnd && count > seenCount, onScroll, jumpToLatest };
}

type VisitChatState = ReturnType<typeof useVisitChat>;

/** The thread as a live log, or what to say while it is empty. */
function ChatThread({ chat, title, viewerRole, homeName, emptyText, closedText }: { chat: VisitChatState; title: string; viewerRole: ViewerRole; homeName: string; emptyText: string; closedText: string }) {
  const { listRef, unseen, onScroll, jumpToLatest } = useStickToLatest(chat.thread.length);
  const closed = chat.status === 'closed';
  if (chat.thread.length === 0) {
    let empty = emptyText;
    if (closed) empty = chat.loaded ? 'No hubo mensajes en esta visita.' : closedText;
    return <p className="chat-empty">{empty}</p>;
  }
  return <>
    <ol ref={listRef} className="chat-thread" role="log" aria-label={`Mensajes de ${title}`} onScroll={onScroll}>
      {chat.thread.map((message) => <li key={message.id} className={`chat-message ${message.own ? 'own' : ''} ${message.delivery}`}>
        <span className="chat-author">{authorLabel(message, viewerRole, homeName)} · <time dateTime={new Date(message.sentAt).toISOString()}>{chatTime(message.sentAt)}</time></span>
        <p>{message.body}</p>
        <MessageDelivery message={message} canRetry={!closed} onRetry={() => chat.retry(message.id)} onDiscard={() => chat.discard(message.id)} />
      </li>)}
    </ol>
    {unseen && <button type="button" className="text-button chat-jump" onClick={jumpToLatest}><ArrowDown size={14} /> Mensajes nuevos</button>}
  </>;
}

/** Connecting, reconnecting or paused, with a way to retry now and the reason of the last failure. */
function ChatConnectionStatus({ chat }: { chat: VisitChatState }) {
  const text = STATUS_TEXT[chat.status];
  if (!text) return null;
  const reconnecting = chat.status === 'reconnecting';
  return <>
    <p className="chat-status" role="status">
      {chat.status !== 'paused' && <LoaderCircle className="spin" size={14} aria-hidden="true" />}{text}
      {reconnecting && <button type="button" className="text-button" onClick={chat.reconnect}><RefreshCw size={14} /> Reintentar ahora</button>}
    </p>
    {reconnecting && chat.connectionError && <p className="chat-status error">{chat.connectionError}</p>}
  </>;
}

/** Enter sends and Shift+Enter breaks the line, as in other chats. The draft is cleared once the message is in the thread. */
function ChatComposer({ onSend }: { onSend: (body: string) => boolean }) {
  const [draft, setDraft] = useState('');
  const inputId = useId();
  const length = draft.trim().length;
  const tooLong = length > CHAT.messageMaxLength;
  const submit = () => { if (onSend(draft)) setDraft(''); };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
  };
  return <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
    <label htmlFor={inputId} className="sr-only">Mensaje</label>
    <textarea id={inputId} rows={2} value={draft} placeholder="Escribí un mensaje…" aria-describedby={`${inputId}-count`} aria-invalid={tooLong || undefined}
      onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} />
    <button className="button primary" disabled={!length || tooLong} aria-label="Enviar mensaje"><SendHorizontal size={18} /></button>
    <span className={`message-count ${tooLong ? 'over' : ''}`} id={`${inputId}-count`}>{tooLong ? `Hasta ${CHAT.messageMaxLength} caracteres` : `${length}/${CHAT.messageMaxLength}`}</span>
  </form>;
}

/**
 * Chat of one visit, the same for the visitor and the residents. A message that did not go through
 * stays in its place with «Reintentar» and «Eliminar»; once the chat ends, the composer gives way to
 * the closing text and the conversation stays readable.
 */
export function VisitChat({ title, viewerRole, homeName, requestAccess, knownClosesAt, emptyText, closedText, onScreen = true }: VisitChatProps) {
  const chat = useVisitChat({ requestAccess, knownClosesAt, historyAfterEnd: viewerRole === 'resident', onScreen });
  const headingId = useId();
  const closed = chat.status === 'closed';
  return <section className="visit-chat" aria-labelledby={headingId}>
    <h3 id={headingId}>{title}</h3>
    <ChatThread chat={chat} title={title} viewerRole={viewerRole} homeName={homeName} emptyText={emptyText} closedText={closedText} />
    <ChatConnectionStatus chat={chat} />
    {closed && (chat.thread.length > 0 || chat.loaded) && <p className="chat-closed">{closedText}</p>}
    {!closed && <ChatComposer onSend={chat.send} />}
  </section>;
}
