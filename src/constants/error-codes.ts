import type { RingRejectionCode } from '@/types/doorbell';

/** Error codes the server sends in a response's `code` and the client reacts to, beyond showing the message. */
export const ERROR_CODES = {
  authRequired: 'AUTH_REQUIRED',
  locationRequired: 'LOCATION_REQUIRED',
  locationImprecise: 'LOCATION_IMPRECISE',
  tooFar: 'TOO_FAR',
  paused: 'PAUSED',
  quietHours: 'QUIET_HOURS',
  cooldown: 'COOLDOWN',
  rateLimited: 'RATE_LIMITED',
  busy: 'BUSY',
} as const satisfies Record<string, string>;

/**
 * Why a visitor's ring did not go through, in the order the server checks them. Each one is counted per
 * home and day (see `ring_rejections`) and summed up in «Timbrazos».
 */
export const RING_REJECTION_CODES = [
  ERROR_CODES.paused, ERROR_CODES.quietHours, ERROR_CODES.locationRequired, ERROR_CODES.locationImprecise, ERROR_CODES.tooFar,
  ERROR_CODES.cooldown, ERROR_CODES.rateLimited, ERROR_CODES.busy,
] as const satisfies readonly RingRejectionCode[];
