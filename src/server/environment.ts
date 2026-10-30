import { AUTH } from '../constants/auth';
import { ENVIRONMENT_RULES } from '../constants/environment';
import { getPostgresConfig } from '../config/database';
import type { Environment } from '../types/environment';

/**
 * A missing or invalid variable, named without ever echoing its value. An `error` stops the build;
 * a `warning` is printed in the build log and the deployment continues.
 */
export interface EnvironmentProblem { variable: string; reason: string; severity: 'error' | 'warning' }

function isHttpsUrl(value: string | undefined) {
  try { return new URL(value ?? '').protocol === 'https:'; } catch { return false; }
}

function isPostgresUrl(value: string | undefined) {
  if (!value) return false;
  try { getPostgresConfig(value); return true; } catch { return false; }
}

/**
 * Checks what a production deployment needs to ring, notify and authenticate. Every rule returns the
 * variable name and a reason; values are never included, so the result is safe to print in a build log.
 */
export function productionEnvironmentProblems(env: Environment): EnvironmentProblem[] {
  const problems: EnvironmentProblem[] = [];
  const require = (variable: string, valid: boolean, reason: string) => { if (!valid) problems.push({ variable, reason, severity: 'error' }); };
  require('DATABASE_URL', isPostgresUrl(env.DATABASE_URL), 'falta o no es una URL PostgreSQL válida');
  require('APP_URL', isHttpsUrl(env.APP_URL), 'falta o no es un origen HTTPS');
  require('VAPID_PUBLIC_KEY', env.VAPID_PUBLIC_KEY?.length === ENVIRONMENT_RULES.vapidPublicKeyLength, 'falta o no es una clave pública VAPID');
  require('VAPID_PRIVATE_KEY', env.VAPID_PRIVATE_KEY?.length === ENVIRONMENT_RULES.vapidPrivateKeyLength, 'falta o no es una clave privada VAPID');
  const subject = env.VAPID_SUBJECT ?? '';
  require('VAPID_SUBJECT', subject.startsWith('mailto:') || isHttpsUrl(subject), 'falta o no empieza con mailto: o https://');
  // Push services accept a placeholder contact, but then nobody can be reached about a delivery problem.
  if (ENVIRONMENT_RULES.placeholderSubjectPattern.test(subject)) problems.push({ variable: 'VAPID_SUBJECT', reason: 'es un contacto de ejemplo: usá un correo o una URL reales', severity: 'warning' });
  require('CRON_SECRET', (env.CRON_SECRET?.length ?? 0) >= ENVIRONMENT_RULES.cronSecretMinimumLength, `falta o tiene menos de ${ENVIRONMENT_RULES.cronSecretMinimumLength} caracteres`);
  if (env.AUTH_PROVIDER === 'self') {
    require('SELF_AUTH_DATABASE_URL', isPostgresUrl(env.SELF_AUTH_DATABASE_URL), 'falta o no es una URL PostgreSQL válida');
    require('SELF_AUTH_SECRET', (env.SELF_AUTH_SECRET?.length ?? 0) >= AUTH.cookieSecretMinimumLength, `falta o tiene menos de ${AUTH.cookieSecretMinimumLength} caracteres`);
    require('GOOGLE_CLIENT_ID', Boolean(env.GOOGLE_CLIENT_ID), 'falta');
    require('GOOGLE_CLIENT_SECRET', Boolean(env.GOOGLE_CLIENT_SECRET), 'falta');
  } else {
    require('NEON_AUTH_BASE_URL', isHttpsUrl(env.NEON_AUTH_BASE_URL), 'falta o no es una URL HTTPS');
    require('NEON_AUTH_COOKIE_SECRET', (env.NEON_AUTH_COOKIE_SECRET?.length ?? 0) >= AUTH.cookieSecretMinimumLength, `falta o tiene menos de ${AUTH.cookieSecretMinimumLength} caracteres`);
  }
  return problems;
}

function describe(problems: EnvironmentProblem[]) {
  return problems.map((problem) => `${problem.variable} (${problem.reason})`).join('; ');
}

/**
 * Runs during `next build`: a production deployment with a missing variable fails to build, so the
 * previous deployment keeps serving instead of a doorbell that cannot notify. Other environments pass.
 */
export function assertDeployEnvironment(env: Environment = process.env) {
  if (env.VERCEL_ENV !== 'production') return;
  const problems = productionEnvironmentProblems(env);
  const warnings = problems.filter((problem) => problem.severity === 'warning');
  const errors = problems.filter((problem) => problem.severity === 'error');
  if (warnings.length) console.warn(`Environment:assertDeployEnvironment warning. Revisá en Vercel: ${describe(warnings)}`);
  if (errors.length) throw new Error(`Environment:assertDeployEnvironment failed. Revisá en Vercel: ${describe(errors)}`);
}
