import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const liveAuth = Boolean(process.env.E2E_NEON_AUTH_EMAIL && process.env.E2E_NEON_AUTH_PASSWORD && process.env.NEON_AUTH_BASE_URL);
export default defineConfig({
  timeout: 60_000,
  testDir: './tests/e2e', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://localhost:3100', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev -- --port 3100', url: 'http://localhost:3100', reuseExistingServer: false, timeout: 120_000,
    env: {
      DATABASE_URL: '', APP_URL: 'http://localhost:3100', LOCAL_DATABASE_PATH: `.data/e2e-${process.pid}`,
      NEON_AUTH_BASE_URL: liveAuth ? process.env.NEON_AUTH_BASE_URL! : '',
      NEON_AUTH_COOKIE_SECRET: 'ringgg-e2e-cookie-secret-for-isolated-local-tests-only',
      RESIDENT_EMAILS: liveAuth ? process.env.E2E_NEON_AUTH_EMAIL! : '',
    },
  },
});
