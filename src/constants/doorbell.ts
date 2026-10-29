export const DOORBELL = {
  messageMaxLength: 160,
  nameMaxLength: 50,
  cooldownSeconds: 30,
  responseWindowSeconds: 120,
  pushTtlSeconds: 90,
  pushTimeoutMs: 8_000,
  pollIntervalMs: 5_000,
  historyLimit: 50,
  maxDevices: 10,
  retentionDays: 30,
  timeZone: 'America/Argentina/Buenos_Aires',
};
export const SESSION = {
  cookie: 'ringgg-session',
  lifetimeSeconds: 60 * 60 * 24 * 7,
  minimumPasswordLength: 12,
  loginWindowSeconds: 60 * 15,
  maxLoginAttempts: 10,
};
export const HTTP = { badRequest: 400, unauthorized: 401, forbidden: 403, notFound: 404, conflict: 409, tooMany: 429, unavailable: 503, internal: 500 };
export const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
export const PUSH_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
export const APP = { name: 'ringgg', theme: '#f26545', background: '#f8f7f3' };
