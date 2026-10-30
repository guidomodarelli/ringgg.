import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
// `.env.local` first: loading never overwrites a variable that is already set.
for (const file of ['.env.local', '.env']) if (existsSync(file)) process.loadEnvFile(file);
/** A dedicated Neon branch keeps the synthetic E2E account out of the real home. */
const liveAuthBaseUrl = process.env.E2E_NEON_AUTH_BASE_URL || process.env.NEON_AUTH_BASE_URL;
const liveAuthEmail = process.env.E2E_NEON_AUTH_EMAIL;
/** The live account, or `null` when its credentials are missing and the specs that need it skip. */
const liveAuth = liveAuthEmail && process.env.E2E_NEON_AUTH_PASSWORD && liveAuthBaseUrl ? { email: liveAuthEmail, baseUrl: liveAuthBaseUrl } : null;
export default defineConfig({
  timeout: 60_000,
  testDir: './tests/e2e', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://localhost:3100', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', screenshot: 'only-on-failure', trace: process.env.CI ? 'retain-on-failure' : 'off' },
  webServer: {
    command: 'npm run dev -- --port 3100', url: 'http://localhost:3100', reuseExistingServer: false, timeout: 120_000,
    env: {
      DATABASE_URL: '', APP_URL: 'http://localhost:3100', LOCAL_DATABASE_PATH: `.data/e2e-${process.pid}`,
      NEON_AUTH_BASE_URL: liveAuth?.baseUrl ?? '',
      NEON_AUTH_COOKIE_SECRET: 'ringgg-e2e-cookie-secret-for-isolated-local-tests-only',
      RESIDENT_EMAILS: liveAuth?.email ?? '',
      RESIDENT_ADMIN_EMAILS: '',
    },
  },
});
