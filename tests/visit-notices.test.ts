import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import nock from 'nock';
import { initialize, type Database, type QueryResult } from '../src/server/database';
import { answerVisit, followVisit, getHome, leaveNote, leaveNoteAndNotify, readVisit, registerVisit, ringAndNotify } from '../src/server/doorbell';
import { saveDevice } from '../src/server/push';
import { DOORBELL, HTTP } from '../src/constants/doorbell';
import { HOMES } from '../src/constants/homes';
import { PUSH } from '../src/constants/push';
import { testDatabase } from './support/test-database';
import { PUSH_SERVICE, withProvider } from './support/push-subscription';

const postgres = new PGlite();
const database = testDatabase(postgres);
const HOME = HOMES.originalId;
const owner = { id: 'owner-identity', email: 'owner@example.com', name: 'Guido', emailVerified: true };
const settings = { bootstrapEmails: [owner.email] };
const CONNECTION_LOST = 'Connection terminated unexpectedly';
const NOTE = 'Pasé a dejar el paquete';

/** The home's only phone, with the keys its browser uses to read what arrives. */
const DEVICE_PATH = 'kitchen-phone';
const receiver = createECDH('prime256v1'); receiver.generateKeys();
const authSecret = randomBytes(16);
const subscription = { endpoint: `${PUSH_SERVICE}/${DEVICE_PATH}`, keys: { p256dh: receiver.getPublicKey('base64url'), auth: authSecret.toString('base64url') } };

/** Layout of an `aes128gcm` message (RFC 8188) and the keys RFC 8291 derives for Web Push. */
const AES128GCM = { saltBytes: 16, keyIdLengthOffset: 20, headerBytes: 21, inputKeyBytes: 32, keyBytes: 16, nonceBytes: 12, tagBytes: 16, lastRecordDelimiter: 2 };

interface Notice { kind: string; title: string; body: string; visitId: string }

/** What the phone shows: the push body decrypted the way its browser does. */
async function readNotice(request: Request): Promise<Notice> {
  const message = Buffer.from(await request.arrayBuffer());
  const salt = message.subarray(0, AES128GCM.saltBytes);
  const senderKey = message.subarray(AES128GCM.headerBytes, AES128GCM.headerBytes + message.readUInt8(AES128GCM.keyIdLengthOffset));
  const record = message.subarray(AES128GCM.headerBytes + senderKey.length);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), receiver.getPublicKey(), senderKey]);
  const inputKey = Buffer.from(hkdfSync('sha256', receiver.computeSecret(senderKey), authSecret, keyInfo, AES128GCM.inputKeyBytes));
  const derive = (label: string, length: number) => Buffer.from(hkdfSync('sha256', inputKey, salt, `Content-Encoding: ${label}\0`, length));
  const decipher = createDecipheriv('aes-128-gcm', derive('aes128gcm', AES128GCM.keyBytes), derive('nonce', AES128GCM.nonceBytes));
  decipher.setAuthTag(record.subarray(-AES128GCM.tagBytes));
  const padded = Buffer.concat([decipher.update(record.subarray(0, -AES128GCM.tagBytes)), decipher.final()]);
  const { kind, title, body, visitId } = JSON.parse(padded.subarray(0, padded.lastIndexOf(AES128GCM.lastRecordDelimiter)).toString('utf8')) as Notice;
  return { kind, title, body, visitId };
}

/** The push service accepts every notice for the phone; the list fills with what the phone shows, in order. */
function phoneNotices() {
  const notices: Notice[] = [];
  nock(PUSH_SERVICE).persist().post(`/${DEVICE_PATH}`).reply(201, async (request: Request) => { notices.push(await readNotice(request)); return ''; });
  return notices;
}

/** A push service that holds every notice until `answer()`: `reached` settles when the first one arrives. */
function slowPushService() {
  const reached = Promise.withResolvers<void>();
  const answers = Promise.withResolvers<void>();
  let received = 0;
  nock(PUSH_SERVICE).persist().post(`/${DEVICE_PATH}`).reply(async () => {
    received += 1;
    reached.resolve();
    await answers.promise;
    return [201, ''];
  });
  return { reached: reached.promise, answer: () => answers.resolve(), received: () => received };
}

/**
 * The app's database port over the same PGlite, on a connection to Neon that breaks once `ready()` holds:
 * from then on `statements` statements fail, and by default it does not come back while the request runs.
 * `ready()` is checked before every statement or transaction; statements of a transaction run on PGlite's own.
 */
function breakingAfter(ready: () => Promise<boolean>, statements = Number.POSITIVE_INFINITY): Database {
  let armed = false;
  let failing = statements;
  async function connect() {
    armed ||= await ready();
    if (!armed || failing <= 0) return;
    failing -= 1;
    throw new Error(CONNECTION_LOST);
  }
  return {
    query: async <Row>(sql: string, params?: unknown[]): Promise<QueryResult<Row>> => { await connect(); return database.query<Row>(sql, params); },
    transaction: async <Result>(work: (transaction: Database) => Promise<Result>) => { await connect(); return database.transaction(work); },
  };
}

/** The app's database port over the same PGlite whose first transaction commits but never answers, as when the connection breaks during its COMMIT. */
function losingFirstCommit(): Database {
  let lost = false;
  return {
    query: <Row>(sql: string, params?: unknown[]) => database.query<Row>(sql, params),
    transaction: async <Result>(work: (transaction: Database) => Promise<Result>) => {
      const result = await database.transaction(work);
      if (lost) return result;
      lost = true;
      throw new Error(CONNECTION_LOST);
    },
  };
}

/** The request failed because the connection broke, directly or as the cause of a notice it could not send. */
function connectionBroke(error: unknown) {
  const { message, cause } = error as Error;
  return message === CONNECTION_LOST || (cause as Error | undefined)?.message === CONNECTION_LOST;
}

const visitStored = (token: string, id: string) => async () => Boolean(await readVisit(database, token, id).catch(() => null));
const noteStored = (token: string, id: string) => async () => (await readVisit(database, token, id).catch(() => null))?.noted === true;
/** Some request holds the visit's notice: its claim is a request limit that names the visit. */
const noticeHeld = (id: string) => async () => (await database.query('SELECT 1 FROM rate_limits WHERE strpos(key, $1) > 0 AND expires_at > NOW()', [id])).rows.length > 0;
const ringOf = (id: string, message = 'Soy del delivery') => ({ id, message, client: 'visitor-a' });
const age = (id: string, seconds: number) => database.query(`UPDATE visits SET created_at = NOW() - $2 * INTERVAL '1 second' WHERE id = $1`, [id, seconds]);
/** Time passes for every request limit, including the claims on notices. */
const elapse = (seconds: number) => database.query(`UPDATE rate_limits SET expires_at = expires_at - $1 * INTERVAL '1 second'`, [seconds]);

beforeAll(async () => { await initialize(database); });
afterAll(async () => { await postgres.close(); });
beforeEach(async () => {
  for (const table of ['devices', 'visits', 'rate_limits']) await database.query(`DELETE FROM ${table}`);
  await saveDevice(database, { homeId: HOME, name: 'Celu de la cocina', subscription }, owner, settings);
});

/** How a visitor's first request fails, given the doorbell token and the visit id. */
type FailedAttempt = [failure: string, attempt: (token: string, id: string) => Promise<void>];

/**
 * Ways the request that stored a ring fails after its commit and leaves the notice claimed without sending
 * it: the claim outlives the request and nobody releases it.
 */
const STRANDED_RINGS: FailedAttempt[] = [
  ['la conexión se corta después del COMMIT y tampoco libera el aviso', (token, id) => expect(ringAndNotify(breakingAfter(visitStored(token, id)), token, ringOf(id))).rejects.toSatisfy(connectionBroke)],
  ['se pierde la respuesta del COMMIT', (token, id) => expect(ringAndNotify(losingFirstCommit(), token, ringOf(id))).rejects.toThrow(CONNECTION_LOST)],
  // Registering without sending is what a request that died right after the commit leaves behind.
  ['la función muere después del COMMIT', async (token, id) => { await registerVisit(database, token, ringOf(id)); }],
];

describe('aviso del timbrazo', () => {
  test('si se pierde una sentencia justo después de registrar la visita, el reintento avisa una sola vez con el mensaje guardado', async () => {
    const home = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await withProvider(async () => {
      const notices = phoneNotices();
      await expect(ringAndNotify(breakingAfter(visitStored(home.token, id), 1), home.token, ringOf(id))).rejects.toSatisfy(connectionBroke);
      expect(notices).toEqual([]);
      expect((await readVisit(database, home.token, id)).delivery).toBe('registered');
      // The visitor retries once with the same operation id, after editing the message; then the page only polls.
      await expect(ringAndNotify(database, home.token, ringOf(id, 'Mensaje distinto'))).resolves.toMatchObject({ id, delivery: 'sent' });
      await expect(followVisit(database, home.token, id)).resolves.toMatchObject({ id, delivery: 'sent' });
      expect(notices).toEqual([{ kind: 'ring', title: `${home.name}: hay alguien en la puerta`, body: 'Soy del delivery', visitId: id }]);
    });
  });

  test.each(STRANDED_RINGS)('si %s, el reintento queda registrado y el seguimiento de la visita avisa una sola vez cuando vence el reclamo', async (_failure, ring) => {
    const home = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await withProvider(async () => {
      const notices = phoneNotices();
      await ring(home.token, id);
      // The visitor's one retry finds the notice still claimed; after its answer the page only polls.
      await expect(ringAndNotify(database, home.token, ringOf(id))).resolves.toMatchObject({ id, delivery: 'registered' });
      await expect(followVisit(database, home.token, id)).resolves.toMatchObject({ id, delivery: 'registered' });
      expect(notices).toEqual([]);
      await elapse(PUSH.claimSeconds);
      await expect(followVisit(database, home.token, id)).resolves.toMatchObject({ id, delivery: 'sent' });
      await expect(followVisit(database, home.token, id)).resolves.toMatchObject({ id, delivery: 'sent' });
      expect(notices).toEqual([{ kind: 'ring', title: `${home.name}: hay alguien en la puerta`, body: 'Soy del delivery', visitId: id }]);
    });
  });

  test('si el envío del seguimiento falla antes de llegar al proveedor, la consulta igual responde y la siguiente avisa', async () => {
    const { token } = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await withProvider(async () => {
      const notices = phoneNotices();
      await registerVisit(database, token, ringOf(id));
      await elapse(PUSH.claimSeconds);
      // The poll claims the notice and loses the next statement, reading the phones.
      await expect(followVisit(breakingAfter(noticeHeld(id), 1), token, id)).resolves.toMatchObject({ id, delivery: 'registered' });
      expect(notices).toEqual([]);
      await expect(followVisit(database, token, id)).resolves.toMatchObject({ id, delivery: 'sent' });
      expect(notices.map((notice) => notice.visitId)).toEqual([id]);
    });
  });

  test('un reintento o un seguimiento que llegan mientras se envía el aviso original no lo repiten', async () => {
    const { token } = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await withProvider(async () => {
      const provider = slowPushService();
      const original = ringAndNotify(database, token, ringOf(id));
      await provider.reached;
      // The provider has not answered the original request yet: both find the notice claimed.
      await expect(ringAndNotify(database, token, ringOf(id))).resolves.toMatchObject({ id, delivery: 'registered' });
      await expect(followVisit(database, token, id)).resolves.toMatchObject({ id, delivery: 'registered' });
      provider.answer();
      await expect(original).resolves.toMatchObject({ id, delivery: 'sent' });
      await expect(followVisit(database, token, id)).resolves.toMatchObject({ id, delivery: 'sent' });
      expect(provider.received()).toBe(1);
    });
  });

  test('cuando el aviso salió, ni los reintentos ni el seguimiento vuelven a avisar', async () => {
    const { token } = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await withProvider(async () => {
      const notices = phoneNotices();
      await expect(ringAndNotify(database, token, ringOf(id))).resolves.toMatchObject({ delivery: 'sent' });
      await expect(followVisit(database, token, id)).resolves.toMatchObject({ delivery: 'sent' });
      await elapse(PUSH.claimSeconds);
      await expect(ringAndNotify(database, token, ringOf(id))).resolves.toMatchObject({ delivery: 'sent' });
      await expect(followVisit(database, token, id)).resolves.toMatchObject({ delivery: 'sent' });
      expect(notices).toHaveLength(1);
    });
  });

  test('pasada la ventana de respuesta, ni el reintento ni el seguimiento hacen sonar el timbre', async () => {
    const { token } = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await withProvider(async () => {
      const notices = phoneNotices();
      await registerVisit(database, token, ringOf(id));
      await elapse(PUSH.claimSeconds);
      await age(id, DOORBELL.responseWindowSeconds + 1);
      await expect(ringAndNotify(database, token, ringOf(id))).resolves.toMatchObject({ delivery: 'registered' });
      await expect(followVisit(database, token, id)).resolves.toMatchObject({ delivery: 'registered' });
      expect(notices).toEqual([]);
    });
  });

  test('si ya respondieron desde el panel, el timbrazo que quedó sin aviso no hace sonar los celulares', async () => {
    const { token } = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await withProvider(async () => {
      const notices = phoneNotices();
      await registerVisit(database, token, ringOf(id));
      await answerVisit(database, { homeId: HOME, id }, 'coming', 'Guido');
      await elapse(PUSH.claimSeconds);
      await expect(followVisit(database, token, id)).resolves.toMatchObject({ delivery: 'registered', reply: 'coming' });
      await expect(ringAndNotify(database, token, ringOf(id))).resolves.toMatchObject({ delivery: 'registered', reply: 'coming' });
      expect(notices).toEqual([]);
    });
  });
});

/** Ways the request that stored a note fails after its commit and leaves the notice claimed without sending it. */
const STRANDED_NOTES: FailedAttempt[] = [
  ['la conexión se corta después de guardarlo y tampoco libera el aviso', (token, id) => expect(leaveNoteAndNotify(breakingAfter(noteStored(token, id)), token, id, NOTE)).rejects.toSatisfy(connectionBroke)],
  ['se pierde la respuesta del COMMIT', (token, id) => expect(leaveNoteAndNotify(losingFirstCommit(), token, id, NOTE)).rejects.toThrow(CONNECTION_LOST)],
  ['la función muere después de guardarlo', async (token, id) => { await leaveNote(database, token, id, NOTE); }],
];

describe('aviso del mensaje de la visita', () => {
  /** A ring nobody answered in time, so the visitor can leave a note. */
  async function unansweredVisit(token: string) {
    const id = crypto.randomUUID();
    await registerVisit(database, token, ringOf(id));
    await age(id, DOORBELL.responseWindowSeconds + 60);
    return id;
  }

  test('si se pierde una sentencia justo después de guardar el mensaje, el reintento lo avisa una sola vez con el mensaje guardado', async () => {
    const home = await getHome(database, HOME);
    const id = await unansweredVisit(home.token);
    await withProvider(async () => {
      const notices = phoneNotices();
      // The note and its claim are stored; reading the phones fails and the claim is released.
      await expect(leaveNoteAndNotify(breakingAfter(noteStored(home.token, id), 1), home.token, id, NOTE)).rejects.toSatisfy(connectionBroke);
      expect(notices).toEqual([]);
      expect((await readVisit(database, home.token, id)).noted).toBe(true);
      await expect(leaveNoteAndNotify(database, home.token, id, 'Otro mensaje')).resolves.toMatchObject({ id, noted: true });
      expect(notices).toEqual([{ kind: 'note', title: `${home.name}: te dejaron un mensaje`, body: NOTE, visitId: id }]);
    });
  });

  test.each(STRANDED_NOTES)('si %s, el reintento pide volver a intentar y, vencido el reclamo, lo avisa una sola vez', async (_failure, note) => {
    const home = await getHome(database, HOME);
    const id = await unansweredVisit(home.token);
    await withProvider(async () => {
      const notices = phoneNotices();
      await note(home.token, id);
      // A success hides the form for good, so while the notice may be unsent the visitor is asked to retry.
      await expect(leaveNoteAndNotify(database, home.token, id, 'Otro mensaje')).rejects.toMatchObject({ status: HTTP.conflict, code: 'NOTE_NOTICE_PENDING' });
      expect(notices).toEqual([]);
      await elapse(PUSH.claimSeconds);
      await expect(leaveNoteAndNotify(database, home.token, id, 'Otro mensaje')).resolves.toMatchObject({ id, noted: true });
      await expect(leaveNoteAndNotify(database, home.token, id, 'Otro mensaje')).resolves.toMatchObject({ id, noted: true });
      expect(notices).toEqual([{ kind: 'note', title: `${home.name}: te dejaron un mensaje`, body: NOTE, visitId: id }]);
    });
  });

  test.each(STRANDED_NOTES)('si %s y la visita retoma su timbrazo, la página ve el mensaje dejado y la relectura lo avisa una sola vez cuando vence el reclamo', async (_failure, note) => {
    const home = await getHome(database, HOME);
    const id = await unansweredVisit(home.token);
    await withProvider(async () => {
      const notices = phoneNotices();
      await note(home.token, id);
      // A resumed page shows a stored note as left and never retries it: its read is what sends it.
      await expect(followVisit(database, home.token, id)).resolves.toMatchObject({ id, noted: true });
      expect(notices).toEqual([]);
      await elapse(PUSH.claimSeconds);
      await expect(followVisit(database, home.token, id)).resolves.toMatchObject({ id, noted: true });
      await expect(followVisit(database, home.token, id)).resolves.toMatchObject({ id, noted: true });
      const sent = [{ kind: 'note', title: `${home.name}: te dejaron un mensaje`, body: NOTE, visitId: id }];
      expect(notices).toEqual(sent);
      // Neither a later read nor a retry after the claim's time sends it again.
      await elapse(PUSH.claimSeconds);
      await expect(followVisit(database, home.token, id)).resolves.toMatchObject({ id, noted: true });
      await expect(leaveNoteAndNotify(database, home.token, id, 'Otro mensaje')).resolves.toMatchObject({ id, noted: true });
      expect(notices).toEqual(sent);
    });
  });

  test('si el mensaje quedó guardado y su envío falló antes del proveedor, la relectura de la visita lo avisa enseguida', async () => {
    const home = await getHome(database, HOME);
    const id = await unansweredVisit(home.token);
    await withProvider(async () => {
      const notices = phoneNotices();
      // Reading the phones fails and the claim is released, so the next read can send it right away.
      await expect(leaveNoteAndNotify(breakingAfter(noteStored(home.token, id), 1), home.token, id, NOTE)).rejects.toSatisfy(connectionBroke);
      await expect(followVisit(database, home.token, id)).resolves.toMatchObject({ id, noted: true });
      expect(notices).toEqual([{ kind: 'note', title: `${home.name}: te dejaron un mensaje`, body: NOTE, visitId: id }]);
    });
  });

  test('un reintento que llega mientras se envía el mensaje original pide volver a intentar y después lo confirma sin repetirlo', async () => {
    const { token } = await getHome(database, HOME);
    const id = await unansweredVisit(token);
    await withProvider(async () => {
      const provider = slowPushService();
      const original = leaveNoteAndNotify(database, token, id, NOTE);
      await provider.reached;
      await expect(leaveNoteAndNotify(database, token, id, NOTE)).rejects.toMatchObject({ code: 'NOTE_NOTICE_PENDING' });
      provider.answer();
      await expect(original).resolves.toMatchObject({ id, noted: true });
      await expect(leaveNoteAndNotify(database, token, id, NOTE)).resolves.toMatchObject({ id, noted: true });
      expect(provider.received()).toBe(1);
    });
  });

  test('si la conexión se corta cuando el celular ya recibió el mensaje, el pedido igual lo confirma sin repetirlo', async () => {
    const { token } = await getHome(database, HOME);
    const id = await unansweredVisit(token);
    await withProvider(async () => {
      const notices = phoneNotices();
      // Storing the phone's delivery health and keeping the claim fail; neither undoes a note that went out.
      await expect(leaveNoteAndNotify(breakingAfter(async () => notices.length > 0), token, id, NOTE)).resolves.toMatchObject({ id, noted: true });
      expect(notices.map((notice) => notice.kind)).toEqual(['note']);
    });
  });

  test('un mensaje ya avisado no se vuelve a avisar, aunque el reintento llegue cuando venció el reclamo', async () => {
    const { token } = await getHome(database, HOME);
    const id = await unansweredVisit(token);
    await withProvider(async () => {
      const notices = phoneNotices();
      await expect(leaveNoteAndNotify(database, token, id, NOTE)).resolves.toMatchObject({ noted: true });
      await elapse(PUSH.claimSeconds);
      await expect(leaveNoteAndNotify(database, token, id, NOTE)).resolves.toMatchObject({ noted: true });
      expect(notices.map((notice) => notice.kind)).toEqual(['note']);
    });
  });
});
