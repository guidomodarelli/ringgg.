import { TIME } from './time';

const DAY_SECONDS = TIME.dayMs / TIME.secondMs;
/**
 * A doorbell can go more than a week without ringing, so a session outlives that; removing a resident
 * already revokes their access to a home, whatever their session.
 */
const SESSION_LIFETIME_DAYS = 30;

export const AUTH = {
  /** A self-managed session lasts this long and is renewed at most once a day (`updateAge`) while it is used. */
  sessionLifetimeSeconds: SESSION_LIFETIME_DAYS * DAY_SECONDS,
  sessionRenewalSeconds: DAY_SECONDS,
  minimumPasswordLength: 8,
  maximumPasswordLength: 128,
  cookieSecretMinimumLength: 32,
  sessionCacheSeconds: 60,
  verificationCodeLength: 6,
  requestTimeoutMs: 15_000,
  selfManagedDefaultSchema: 'ringgg_auth',
  schemaNamePattern: /^[a-z_][a-z0-9_]*$/,
  reservedSchemas: ['neon_auth', 'public', 'pg_catalog', 'information_schema'],
};

export type AuthFormMode = 'sign-in' | 'sign-up' | 'verify' | 'forgot' | 'reset';

const MESSAGES = {
  invalidCredentials: 'El correo o la contraseña no son correctos.',
  unverified: 'Verificá tu correo antes de ingresar. Podés pedir un código nuevo.',
  existing: 'Ya existe una cuenta con ese correo. Ingresá o recuperá tu contraseña.',
  invalidLink: 'El enlace venció o no es válido. Pedí uno nuevo.',
  tooMany: 'Hubo demasiados intentos. Esperá un momento antes de reintentar.',
};

/**
 * Better Auth codes (returned as `{ error }`) and the codes Neon's client throws after normalizing
 * them (`invalid_credentials`, `email_not_confirmed`...): the same failure shows the same message.
 */
export const AUTH_ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: MESSAGES.invalidCredentials,
  INVALID_PASSWORD: 'La contraseña no es correcta.',
  invalid_credentials: MESSAGES.invalidCredentials,
  EMAIL_NOT_VERIFIED: MESSAGES.unverified,
  email_not_confirmed: MESSAGES.unverified,
  USER_ALREADY_EXISTS: MESSAGES.existing,
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: MESSAGES.existing,
  user_already_exists: MESSAGES.existing,
  email_exists: MESSAGES.existing,
  weak_password: `Usá una contraseña de entre ${AUTH.minimumPasswordLength} y ${AUTH.maximumPasswordLength} caracteres.`,
  INVALID_OTP: 'El código no es correcto o ya venció. Pedí uno nuevo.',
  OTP_EXPIRED: 'El código venció. Pedí uno nuevo.',
  INVALID_TOKEN: MESSAGES.invalidLink,
  bad_jwt: MESSAGES.invalidLink,
  TOO_MANY_REQUESTS: MESSAGES.tooMany,
  over_request_rate_limit: MESSAGES.tooMany,
  over_email_send_rate_limit: MESSAGES.tooMany,
};

/** Codes that mean the account exists but its email still needs the verification code. */
export const UNVERIFIED_EMAIL_CODES: ReadonlySet<string> = new Set(['EMAIL_NOT_VERIFIED', 'email_not_confirmed']);
