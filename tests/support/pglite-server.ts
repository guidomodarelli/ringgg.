import { createServer, type Socket } from 'node:net';
import type { PGlite } from '@electric-sql/pglite';

/** Codes a client sends instead of a startup message, to negotiate encryption or cancel a query. */
const NEGOTIATION_CODES = { ssl: 80_877_103, gss: 80_877_104, cancel: 80_877_102 };
/** Bytes before a startup packet's code (its length) and before a typed message's body (type and length). */
const STARTUP_HEADER_BYTES = 8;
const MESSAGE_HEADER_BYTES = 5;
/** Frontend messages the backend answers right away: Sync, a simple Query and Flush. Earlier ones wait for them. */
const BATCH_ENDS = new Set(['S', 'Q', 'H']);
const TERMINATE = 'X';
/** Session settings a server reports after startup; `pg` reads them like it does from Neon. */
const SERVER_PARAMETERS = { server_encoding: 'UTF8', client_encoding: 'UTF8', DateStyle: 'ISO, MDY', integer_datetimes: 'on', standard_conforming_strings: 'on' };

function int32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value);
  return buffer;
}

function backendMessage(type: string, body: Buffer) {
  return Buffer.concat([Buffer.from(type, 'latin1'), int32(body.length + 4), body]);
}

/** A trusted login (no password), the session settings, a process key for cancels and "ready, idle". */
const STARTUP_REPLY = Buffer.concat([
  backendMessage('R', int32(0)),
  ...Object.entries(SERVER_PARAMETERS).map(([name, value]) => backendMessage('S', Buffer.from(`${name}\0${value}\0`))),
  backendMessage('K', Buffer.concat([int32(1), int32(1)])),
  backendMessage('Z', Buffer.from('I')),
]);

/**
 * One client connection. PGlite already runs a single backend session, so the bridge answers the startup
 * itself and passes every later message to it; each batch (up to a Sync or a simple query) runs alone, so
 * two pooled connections never interleave their extended-protocol messages.
 */
function serveConnection(postgres: PGlite, socket: Socket) {
  let buffered = Buffer.alloc(0);
  let started = false;
  let batch: Buffer[] = [];
  let work = Promise.resolve();
  function take(length: number) {
    const message = buffered.subarray(0, length);
    buffered = buffered.subarray(length);
    return message;
  }
  function nextStartup() {
    if (buffered.length < STARTUP_HEADER_BYTES || buffered.length < buffered.readInt32BE(0)) return null;
    return take(buffered.readInt32BE(0));
  }
  function nextMessage() {
    if (buffered.length < MESSAGE_HEADER_BYTES || buffered.length < 1 + buffered.readInt32BE(1)) return null;
    return take(1 + buffered.readInt32BE(1));
  }
  async function answer(messages: Buffer[]) {
    return postgres.runExclusive(async () => {
      const replies: Uint8Array[] = [];
      for (const message of messages) replies.push(await postgres.execProtocolRaw(new Uint8Array(message)));
      return Buffer.concat(replies);
    });
  }
  function startup() {
    for (let packet = nextStartup(); packet; packet = nextStartup()) {
      const code = packet.readInt32BE(4);
      if (code === NEGOTIATION_CODES.cancel) { socket.end(); return; }
      if (code === NEGOTIATION_CODES.ssl || code === NEGOTIATION_CODES.gss) { socket.write('N'); continue; }
      started = true; socket.write(STARTUP_REPLY); return;
    }
  }
  async function drain() {
    if (!started) startup();
    if (!started) return;
    for (let message = nextMessage(); message; message = nextMessage()) {
      const type = String.fromCodePoint(message[0]);
      if (type === TERMINATE) { socket.end(); return; }
      batch.push(message);
      if (!BATCH_ENDS.has(type)) continue;
      const messages = batch;
      batch = [];
      socket.write(await answer(messages));
    }
  }
  socket.on('data', (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    work = work.then(drain).catch((error: unknown) => { socket.destroy(error instanceof Error ? error : new Error('servePglite: a message failed', { cause: error })); });
  });
  // A pool that closes its clients resets the connection; that is not a failure of the test.
  socket.on('error', () => undefined);
}

/**
 * Serves an in-memory PGlite on localhost through the PostgreSQL wire protocol, so the production `pg`
 * driver (and Better Auth through Kysely) connect to real PostgreSQL in tests, by connection URL.
 */
export async function servePglite(postgres: PGlite): Promise<{ url: string; close: () => Promise<void> }> {
  // Raw protocol calls skip PGlite's own readiness check.
  await postgres.waitReady;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    serveConnection(postgres, socket);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('servePglite: the server did not expose a port');
  return {
    url: `postgres://postgres@127.0.0.1:${address.port}/postgres`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
