import { describe, expect, test } from 'vitest';
import { assertDeployEnvironment, productionEnvironmentProblems } from '../src/server/environment';
import { getConfig } from '../src/server/config';

const PRODUCTION = {
  VERCEL: '1',
  VERCEL_ENV: 'production',
  DATABASE_URL: 'postgresql://ringgg:secret-password@ep-test-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require',
  APP_URL: 'https://timbre.example.app',
  VAPID_PUBLIC_KEY: 'B'.repeat(87),
  VAPID_PRIVATE_KEY: 'p'.repeat(43),
  VAPID_SUBJECT: 'mailto:avisos@ringgg.app',
  CRON_SECRET: 'cron-secret-with-enough-length',
  NEON_AUTH_BASE_URL: 'https://auth.neon.test/neondb/auth',
  NEON_AUTH_COOKIE_SECRET: 'c'.repeat(32),
};

describe('variables de un deployment de producción', () => {
  test('una configuración completa no tiene problemas', () => {
    expect(productionEnvironmentProblems(PRODUCTION)).toEqual([]);
  });

  test('nombra cada variable faltante o inválida sin repetir su valor', () => {
    const problems = productionEnvironmentProblems({ ...PRODUCTION, APP_URL: 'http://timbre.example.app', VAPID_SUBJECT: 'admin@ringgg.app', CRON_SECRET: 'corta', NEON_AUTH_BASE_URL: undefined });
    expect(problems.map(({ variable, severity }) => `${variable}:${severity}`)).toEqual(['APP_URL:error', 'VAPID_SUBJECT:error', 'CRON_SECRET:error', 'NEON_AUTH_BASE_URL:error']);
    const printed = JSON.stringify(problems);
    for (const value of ['http://timbre.example.app', 'admin@ringgg.app', 'corta']) expect(printed).not.toContain(value);
  });

  test('un contacto de ejemplo para los avisos es una advertencia, no un error', () => {
    expect(productionEnvironmentProblems({ ...PRODUCTION, VAPID_SUBJECT: 'mailto:admin@example.com' })).toEqual([{ variable: 'VAPID_SUBJECT', reason: expect.any(String), severity: 'warning' }]);
    expect(() => assertDeployEnvironment({ ...PRODUCTION, VAPID_SUBJECT: 'mailto:admin@example.com' })).not.toThrow();
  });

  test('con acceso de Google exige sus credenciales en lugar de las de Neon Auth', () => {
    const problems = productionEnvironmentProblems({ ...PRODUCTION, AUTH_PROVIDER: 'self', NEON_AUTH_BASE_URL: undefined });
    expect(problems.map((problem) => problem.variable)).toEqual(['SELF_AUTH_DATABASE_URL', 'SELF_AUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
  });

  test('el build de producción falla con un mensaje accionable; preview y desarrollo no se validan', () => {
    expect(() => assertDeployEnvironment({ ...PRODUCTION, DATABASE_URL: undefined })).toThrow(/Environment:assertDeployEnvironment failed\. Revisá en Vercel: DATABASE_URL/);
    expect(() => assertDeployEnvironment({ ...PRODUCTION, VERCEL_ENV: 'preview', DATABASE_URL: undefined })).not.toThrow();
    expect(() => assertDeployEnvironment({})).not.toThrow();
  });
});

describe('origen público y orígenes permitidos', () => {
  test('en desarrollo usa localhost y genera claves de push locales', () => {
    const config = getConfig({ NODE_ENV: 'development' });
    expect(config.origin).toBe('http://localhost:3000');
    expect(config.allowedOrigins).toEqual(['http://localhost:3000']);
    expect(config.publicKey).not.toBe('');
    expect(config.subject).toMatch(/^mailto:/);
  });

  test('un preview sin APP_URL acepta su URL de rama y la del deployment', () => {
    const config = getConfig({ VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'ringgg-git-feature.vercel.app', VERCEL_URL: 'ringgg-abc123.vercel.app' });
    expect(config.origin).toBe('https://ringgg-git-feature.vercel.app');
    expect(config.allowedOrigins).toEqual(['https://ringgg-git-feature.vercel.app', 'https://ringgg-abc123.vercel.app']);
    expect(config.publicKey).toBe('');
  });

  test('un deployment nunca cae a localhost ni a credenciales de ejemplo', () => {
    expect(() => getConfig({ VERCEL: '1', VERCEL_ENV: 'production' })).toThrow(/Config:getConfig failed: APP_URL/);
    const config = getConfig({ VERCEL: '1', VERCEL_ENV: 'production', APP_URL: 'https://timbre.example.app/' });
    expect(config).toMatchObject({ origin: 'https://timbre.example.app', allowedOrigins: ['https://timbre.example.app'], publicKey: '', subject: '' });
  });
});
