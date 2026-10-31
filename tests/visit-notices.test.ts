import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import nock from 'nock';
import { initialize, type Database, type QueryResult } from '../src/server/database';
import { getHome, leaveNoteAndNotify, readVisit, registerVisit, ringAndNotify } from '../src/server/doorbell';
import { saveDevice } from '../src/server/push';
import { DOORBELL } from '../src/constants/doorbell';
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

/**
 * The app's database port over the same PGlite, losing one statement: the first one sent after `ready()`
 * holds fails, as when the connection to Neon breaks right after a commit. Statements of a transaction run
 * on PGlite's own; `ready()` is checked after every statement and transaction completes.
 */
function droppingOnceAfter(ready: () => Promise<boolean>): Database {
  let armed = false;
  let dropped = false;
  async function settle<Result>(result: Result) {
    if (!armed) armed = await ready();
    return result;
  }
  return {
    query: async <Row>(sql: string, params?: unknown[]): Promise<QueryResult<Row>> => {
      if (armed && !dropped) { dropped = true; throw new Error(CONNECTION_LOST); }
      return settle(await database.query<Row>(sql, params));
    },
    transaction: async <Result>(work: (transaction: Database) => Promise<Result>) => settle(await database.transaction(work)),
  };
}

const visitStored = (token: string, id: string) => async () => Boolean(await readVisit(database, token, id).catch(() => null));
const noteStored = (token: string, id: string) => async () => (await readVisit(database, token, id).catch(() => null))?.noted === true;
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

describe('aviso del timbrazo', () => {
  test('si la conexión se corta después de registrar la visita y antes del aviso, el reintento avisa una sola vez con el mensaje guardado', async () => {
    const home = await getHome(database, HOME);
    const id = crypto.randomUUID();
    const flaky = droppingOnceAfter(visitStored(home.token, id));
    await withProvider(async () => {
      const notices = phoneNotices();
      await expect(ringAndNotify(flaky, home.token, ringOf(id))).rejects.toMatchObject({ cause: { message: CONNECTION_LOST } });
      expect(notices).toEqual([]);
      expect((await readVisit(database, home.token, id)).delivery).toBe('registered');
      // The visitor retries with the same operation id, after editing the message.
      await expect(ringAndNotify(flaky, home.token, ringOf(id, 'Mensaje distinto'))).resolves.toMatchObject({ id, delivery: 'sent' });
      await expect(ringAndNotify(flaky, home.token, ringOf(id))).resolves.toMatchObject({ id, delivery: 'sent' });
      expect(notices).toEqual([{ kind: 'ring', title: `${home.name}: hay alguien en la puerta`, body: 'Soy del delivery', visitId: id }]);
    });
  });

  test('un reintento que llega mientras se envía el aviso original no lo repite', async () => {
    const { token } = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await withProvider(async () => {
      let received = 0;
      const providerReached = Promise.withResolvers<void>();
      const providerAnswers = Promise.withResolvers<void>();
      nock(PUSH_SERVICE).post(`/${DEVICE_PATH}`).reply(async () => {
        received += 1;
        providerReached.resolve();
        await providerAnswers.promise;
        return [201, ''];
      });
      const original = ringAndNotify(database, token, ringOf(id));
      await providerReached.promise;
      // The provider has not answered the original request yet: the retry finds the notice claimed.
      await expect(ringAndNotify(database, token, ringOf(id))).resolves.toMatchObject({ id, delivery: 'registered' });
      providerAnswers.resolve();
      await expect(original).resolves.toMatchObject({ id, delivery: 'sent' });
      expect(received).toBe(1);
    });
  });

  test('si el pedido que registró la visita murió sin avisar, el reintento avisa cuando vence su reclamo', async () => {
    const { token } = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await withProvider(async () => {
      const notices = phoneNotices();
      // Registering without sending is what a request that died right after the commit leaves behind.
      await registerVisit(database, token, ringOf(id));
      await expect(ringAndNotify(database, token, ringOf(id))).resolves.toMatchObject({ delivery: 'registered' });
      expect(notices).toEqual([]);
      await elapse(PUSH.claimSeconds);
      await expect(ringAndNotify(database, token, ringOf(id))).resolves.toMatchObject({ delivery: 'sent' });
      expect(notices.map((notice) => notice.visitId)).toEqual([id]);
    });
  });

  test('cuando el aviso salió, los reintentos devuelven la entrega guardada sin volver a avisar', async () => {
    const { token } = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await withProvider(async () => {
      const notices = phoneNotices();
      await expect(ringAndNotify(database, token, ringOf(id))).resolves.toMatchObject({ delivery: 'sent' });
      await expect(ringAndNotify(database, token, ringOf(id))).resolves.toMatchObject({ delivery: 'sent' });
      await elapse(PUSH.claimSeconds);
      await expect(ringAndNotify(database, token, ringOf(id))).resolves.toMatchObject({ delivery: 'sent' });
      expect(notices).toHaveLength(1);
    });
  });

  test('pasada la ventana de respuesta, el reintento ya no hace sonar el timbre', async () => {
    const { token } = await getHome(database, HOME);
    const id = crypto.randomUUID();
    await withProvider(async () => {
      const notices = phoneNotices();
      await expect(ringAndNotify(droppingOnceAfter(visitStored(token, id)), token, ringOf(id))).rejects.toMatchObject({ cause: { message: CONNECTION_LOST } });
      await age(id, DOORBELL.responseWindowSeconds + 1);
      await expect(ringAndNotify(database, token, ringOf(id))).resolves.toMatchObject({ delivery: 'registered' });
      expect(notices).toEqual([]);
    });
  });
});

describe('aviso del mensaje de la visita', () => {
  /** A ring nobody answered in time, so the visitor can leave a note. */
  async function unansweredVisit(token: string) {
    const id = crypto.randomUUID();
    await registerVisit(database, token, ringOf(id));
    await age(id, DOORBELL.responseWindowSeconds + 60);
    return id;
  }

  test('si la conexión se corta después de guardar el mensaje y antes del aviso, el reintento lo avisa una sola vez con el mensaje guardado', async () => {
    const home = await getHome(database, HOME);
    const id = await unansweredVisit(home.token);
    const flaky = droppingOnceAfter(noteStored(home.token, id));
    await withProvider(async () => {
      const notices = phoneNotices();
      await expect(leaveNoteAndNotify(flaky, home.token, id, 'Pasé a dejar el paquete')).rejects.toThrow(CONNECTION_LOST);
      expect(notices).toEqual([]);
      expect((await readVisit(database, home.token, id)).noted).toBe(true);
      await expect(leaveNoteAndNotify(flaky, home.token, id, 'Otro mensaje')).resolves.toMatchObject({ id, noted: true });
      await expect(leaveNoteAndNotify(flaky, home.token, id, 'Otro mensaje')).resolves.toMatchObject({ id, noted: true });
      expect(notices).toEqual([{ kind: 'note', title: `${home.name}: te dejaron un mensaje`, body: 'Pasé a dejar el paquete', visitId: id }]);
    });
  });

  test('un mensaje ya avisado no se vuelve a avisar, aunque el reintento llegue cuando venció el reclamo', async () => {
    const { token } = await getHome(database, HOME);
    const id = await unansweredVisit(token);
    await withProvider(async () => {
      const notices = phoneNotices();
      await expect(leaveNoteAndNotify(database, token, id, 'Pasé a dejar el paquete')).resolves.toMatchObject({ noted: true });
      await elapse(PUSH.claimSeconds);
      await expect(leaveNoteAndNotify(database, token, id, 'Pasé a dejar el paquete')).resolves.toMatchObject({ noted: true });
      expect(notices.map((notice) => notice.kind)).toEqual(['note']);
    });
  });
});
