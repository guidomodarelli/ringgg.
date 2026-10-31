export const DOORBELL = {
  messageMaxLength: 160,
  noteMaxLength: 160,
  nameMaxLength: 50,
  answeredByMaxLength: 60,
  responseWindowSeconds: 120,
  /** Visitors can leave a note on an unanswered or "away" visit for this long after ringing (15 minutes). */
  noteWindowSeconds: 900,
  historyLimit: 50,
  retentionDays: 30,
  timeZone: 'America/Argentina/Buenos_Aires',
};

/** Where a visitor's browser keeps its ring at one door (plus the door's token), so a reload or a new scan of the QR shows it again. */
export const VISIT_STORAGE_KEY_PREFIX = 'ringgg:visit:';

/**
 * Ring limits apply per visitor client (a hashed network address) plus a home-wide burst cap,
 * so a single client cannot lock real visitors out by ringing every few seconds.
 */
export const RING_LIMITS = {
  clientCooldownSeconds: 30,
  /** 10 minutes. */
  clientWindowSeconds: 600,
  clientMaxPerWindow: 4,
  /** 10 minutes. */
  homeWindowSeconds: 600,
  homeMaxPerWindow: 12,
  /** Characters kept from the client's salted hash: enough to tell clients apart. */
  clientKeyLength: 32,
  /** Only for local development: deployments must salt the client hash with an auth secret. */
  developmentSalt: 'ringgg-local-development',
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

/** `resume` ends any pause; the other modes pause until a moment or until someone resumes it. */
export type PauseMode = 'hour' | 'morning' | 'indefinite' | 'resume';
export const PAUSE_MODES = ['hour', 'morning', 'indefinite', 'resume'] as const satisfies readonly PauseMode[];
export const PAUSE = {
  hourMinutes: 60,
  /** "Until tomorrow morning" resumes at this time in the home's time zone. */
  morningResumeTime: '08:00',
};
export const PAUSE_OPTIONS = [
  { mode: 'hour', label: 'Durante 1 hora', feedback: 'Timbre pausado durante 1 hora.' },
  { mode: 'morning', label: 'Hasta mañana a las 8', feedback: 'Timbre pausado hasta mañana a las 8.' },
  { mode: 'indefinite', label: 'Hasta que lo reactive', feedback: 'Timbre pausado hasta que lo reactives.' },
] as const satisfies ReadonlyArray<{ mode: Exclude<PauseMode, 'resume'>; label: string; feedback: string }>;

export const HTTP = { switchingProtocols: 101, ok: 200, noContent: 204, badRequest: 400, unauthorized: 401, forbidden: 403, notFound: 404, conflict: 409, gone: 410, upgradeRequired: 426, tooMany: 429, unavailable: 503, internal: 500 };
export const APP = { name: 'ringgg', theme: '#f26545', background: '#f8f7f3' };
