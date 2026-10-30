import { createECDH, randomBytes } from 'node:crypto';
import nock from 'nock';

/** The push service host every test subscription points to. */
export const PUSH_SERVICE = 'https://fcm.googleapis.com';

/** A subscription with real P-256 keys, so web-push can encrypt the payload. */
export function pushSubscription(path: string) {
  const curve = createECDH('prime256v1'); curve.generateKeys();
  return { endpoint: `${PUSH_SERVICE}/${path}`, keys: { p256dh: curve.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}

/** Runs a send against the provider stub only; any other network access fails the test. */
export async function withProvider<T>(work: () => Promise<T>) {
  nock.disableNetConnect();
  try { return await work(); } finally { nock.cleanAll(); nock.enableNetConnect(); }
}
