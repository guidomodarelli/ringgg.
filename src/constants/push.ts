import { HTTP } from './doorbell';

/** What a notification announces; each kind has its own delivery policy. */
export type PushKind = 'ring' | 'note' | 'test';
export type PushUrgency = 'high' | 'normal';

/**
 * Rings expire with the answer window, so a late delivery is useless. A note stays relevant for
 * hours, so a phone that was offline still gets it when it reconnects.
 */
export const PUSH_POLICIES = {
  ring: { ttlSeconds: 90, urgency: 'high' },
  /** 12 hours. */
  note: { ttlSeconds: 43_200, urgency: 'normal' },
  test: { ttlSeconds: 90, urgency: 'high' },
} as const satisfies Record<PushKind, { ttlSeconds: number; urgency: PushUrgency }>;

export const PUSH = {
  timeoutMs: 8_000,
  /**
   * How long a request holds a visit's notice while it sends it. Longer than a send, whose provider calls
   * time out after `timeoutMs`, so neither a retry nor the visitor's poll sends it again meanwhile. When the
   * request died before sending, the next poll (for a ring) or retry (for a note) after this long sends it.
   */
  claimSeconds: 20,
  /** Status codes with which the provider says the subscription no longer exists. */
  goneStatuses: [HTTP.notFound, HTTP.gone],
  endpointMaxLength: 2048,
  /** Base64url lengths of the subscription keys: an uncompressed P-256 public key and a 16-byte auth secret. */
  keyLengths: { p256dh: 87, auth: 22 },
};
export const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
export const PUSH_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Messages between the service worker and open dashboards. */
export const WORKER_MESSAGES = { push: 'ringgg:push', open: 'ringgg:open' } as const;
