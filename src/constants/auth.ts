export const AUTH = {
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

export const AUTH_ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'El correo o la contraseña no son correctos.',
  INVALID_PASSWORD: 'La contraseña no es correcta.',
  EMAIL_NOT_VERIFIED: 'Verificá tu correo antes de ingresar. Podés pedir un código nuevo.',
  USER_ALREADY_EXISTS: 'Ya existe una cuenta con ese correo. Ingresá o recuperá tu contraseña.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Ya existe una cuenta con ese correo. Ingresá o recuperá tu contraseña.',
  INVALID_OTP: 'El código no es correcto o ya venció. Pedí uno nuevo.',
  OTP_EXPIRED: 'El código venció. Pedí uno nuevo.',
  INVALID_TOKEN: 'El enlace venció o no es válido. Pedí uno nuevo.',
  TOO_MANY_REQUESTS: 'Hubo demasiados intentos. Esperá un momento antes de reintentar.',
};
