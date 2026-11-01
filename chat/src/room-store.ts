import { CHAT } from '../../src/constants/chat';
import { TIME } from '../../src/constants/time';
import type { ChatAnswer, ChatClaims, ChatMessage, ChatRole } from '../../src/lib/chat-protocol';

/** The visit a room belongs to, set by its first socket or its answer, and when it last notified the residents. */
export interface RoomState { visitId: string; origin: string; closesAt: number; lastNotifiedAt: number }

/** What opens a room: a socket's claims or the app's answer announcement both carry it. */
export type RoomOpening = Pick<ChatClaims, 'visitId' | 'origin' | 'closesAt'>;

export type AppendOutcome = { status: 'added' | 'duplicate'; message: ChatMessage } | { status: 'full' };

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS room (
    id INTEGER PRIMARY KEY CHECK (id = 1), visit_id TEXT NOT NULL, origin TEXT NOT NULL,
    closes_at INTEGER NOT NULL, last_notified_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, author TEXT NOT NULL, name TEXT, body TEXT NOT NULL, sent_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS answer (
    id INTEGER PRIMARY KEY CHECK (id = 1), reply TEXT NOT NULL, answered_at TEXT NOT NULL
  );`;

type RoomRow = { visit_id: string; origin: string; closes_at: number; last_notified_at: number };
type MessageRow = { id: string; author: ChatRole; name: string | null; body: string; sent_at: number };
type AnswerRow = { reply: ChatAnswer['reply']; answered_at: string };

function toMessage(row: MessageRow): ChatMessage {
  return { id: row.id, author: row.author, name: row.name, body: row.body, sentAt: row.sent_at };
}

/**
 * One visit's room in the Durable Object's own SQLite. Every call is synchronous: nothing else runs on
 * the object between reading and writing, so checks and writes stay atomic without locks.
 */
export class RoomStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(SCHEMA);
  }

  /**
   * The room of this visit: whatever opens it first (a socket or the answer) records which visit and app
   * it belongs to. The schema is created again because an erased room can be opened by the same object
   * that erased it.
   */
  open(opening: RoomOpening): RoomState {
    this.sql.exec(SCHEMA);
    this.sql.exec('INSERT INTO room (id, visit_id, origin, closes_at) VALUES (1, ?, ?, ?) ON CONFLICT (id) DO NOTHING', opening.visitId, opening.origin, opening.closesAt);
    const room = this.room();
    if (!room) throw new Error(`RoomStore:open failed: room of visit ${opening.visitId} was not saved`);
    return room;
  }

  /** The residents' answer, once they gave it. */
  answer(): ChatAnswer | null {
    const [row] = this.sql.exec<AnswerRow>('SELECT reply, answered_at FROM answer WHERE id = 1').toArray();
    return row ? { reply: row.reply, answeredAt: row.answered_at } : null;
  }

  /** Keeps the first answer, as the app does: a repeated announcement returns the stored one. */
  recordAnswer(answer: ChatAnswer): ChatAnswer {
    this.sql.exec('INSERT INTO answer (id, reply, answered_at) VALUES (1, ?, ?) ON CONFLICT (id) DO NOTHING', answer.reply, answer.answeredAt);
    const stored = this.answer();
    if (!stored) throw new Error(`RoomStore:recordAnswer failed: answer of visit ${this.room()?.visitId ?? 'unknown'} was not saved`);
    return stored;
  }

  room(): RoomState | null {
    const [row] = this.sql.exec<RoomRow>('SELECT visit_id, origin, closes_at, last_notified_at FROM room WHERE id = 1').toArray();
    return row ? { visitId: row.visit_id, origin: row.origin, closesAt: row.closes_at, lastNotifiedAt: row.last_notified_at } : null;
  }

  messages(): ChatMessage[] {
    return this.sql.exec<MessageRow>('SELECT id, author, name, body, sent_at FROM messages ORDER BY sent_at, rowid').toArray().map(toMessage);
  }

  /** Stores a message once: a retry with the same id returns the stored one instead of adding it again. */
  append(message: ChatMessage): AppendOutcome {
    const [stored] = this.sql.exec<MessageRow>('SELECT id, author, name, body, sent_at FROM messages WHERE id = ?', message.id).toArray();
    if (stored) return { status: 'duplicate', message: toMessage(stored) };
    const [{ count }] = this.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM messages').toArray();
    if (count >= CHAT.roomMessageLimit) return { status: 'full' };
    this.sql.exec('INSERT INTO messages (id, author, name, body, sent_at) VALUES (?, ?, ?, ?, ?)', message.id, message.author, message.name, message.body, message.sentAt);
    return { status: 'added', message };
  }

  /**
   * Claims the notification slot when the cooldown passed. It is written before the request goes out,
   * so two messages in a row never both notify.
   */
  claimNotification(now: number): boolean {
    const claimed = this.sql.exec('UPDATE room SET last_notified_at = ? WHERE id = 1 AND last_notified_at <= ?', now, now - CHAT.notifyCooldownSeconds * TIME.secondMs);
    return claimed.rowsWritten > 0;
  }
}
