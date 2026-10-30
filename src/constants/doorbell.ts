export const DOORBELL = {
  messageMaxLength: 160,
  noteMaxLength: 160,
  nameMaxLength: 50,
  answeredByMaxLength: 60,
  responseWindowSeconds: 120,
  /** Visitors can leave a note on an unanswered or "away" visit for this long after ringing. */
  noteWindowSeconds: 15 * 60,
  pushTtlSeconds: 90,
  pushTimeoutMs: 8_000,
  pollIntervalMs: 5_000,
  historyLimit: 50,
  maxDevices: 10,
  retentionDays: 30,
  timeZone: 'America/Argentina/Buenos_Aires',
};

/**
 * Ring limits apply per visitor client (a hashed network address) plus a home-wide burst cap,
 * so a single client cannot lock real visitors out by ringing every few seconds.
 */
export const RING_LIMITS = {
  clientCooldownSeconds: 30,
  clientWindowSeconds: 10 * 60,
  clientMaxPerWindow: 4,
  homeWindowSeconds: 10 * 60,
  homeMaxPerWindow: 12,
};

export const VISIT_REPLIES = {
  coming: { label: 'Ya voy', visitorTitle: '¡Ya van!', visitorDetail: 'Recibieron tu aviso y están en camino. Esperá un momento.', history: 'Va en camino' },
  soon: { label: 'En 5 minutos', visitorTitle: 'Salen en 5 minutos', visitorDetail: 'Recibieron tu aviso. Esperá un ratito, ya salen.', history: 'Sale en 5 minutos' },
  leave: { label: 'Dejalo en la puerta', visitorTitle: 'Dejalo en la puerta', visitorDetail: 'Podés dejarlo en la puerta. ¡Gracias!', history: 'Pidió dejarlo en la puerta' },
  away: { label: 'No estoy', visitorTitle: 'No están en casa', visitorDetail: 'Ahora no pueden atenderte. Si querés, dejales un mensaje.', history: 'Avisó que no está' },
} as const;
export type VisitReply = keyof typeof VISIT_REPLIES;
export const VISIT_REPLY_KEYS = Object.keys(VISIT_REPLIES) as [VisitReply, ...VisitReply[]];
/** Replies offered as notification actions; platforms show at most two. */
export const NOTIFICATION_REPLIES: readonly VisitReply[] = ['coming', 'leave'];

export const QUIET_HOURS_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const HTTP = { badRequest: 400, unauthorized: 401, forbidden: 403, notFound: 404, conflict: 409, tooMany: 429, unavailable: 503, internal: 500 };
export const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
export const PUSH_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
export const APP = { name: 'ringgg', theme: '#f26545', background: '#f8f7f3' };
