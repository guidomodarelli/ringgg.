import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
// `.env.local` first: loading never overwrites a variable that is already set.
for (const file of ['.env.local', '.env']) if (existsSync(file)) process.loadEnvFile(file);
/** A dedicated Neon branch keeps the synthetic E2E account out of the real home. */
const liveAuthBaseUrl = process.env.E2E_NEON_AUTH_BASE_URL || process.env.NEON_AUTH_BASE_URL;
const liveAuthEmail = process.env.E2E_NEON_AUTH_EMAIL;
/** The live account, or `null` when its credentials are missing and the specs that need it skip. */
const liveAuth = liveAuthEmail && process.env.E2E_NEON_AUTH_PASSWORD && liveAuthBaseUrl ? { email: liveAuthEmail, baseUrl: liveAuthBaseUrl } : null;
/** Port of the app under test; `E2E_PORT` lets two checkouts run their suites at the same time. */
const DEFAULT_E2E_PORT = 3100;
const appPort = Number(process.env.E2E_PORT || DEFAULT_E2E_PORT);
const appUrl = `http://localhost:${appPort}`;
export default defineConfig({
  timeout: 60_000,
  testDir: './tests/e2e', fullyParallel: false, workers: 1,
  use: { baseURL: appUrl, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', screenshot: 'only-on-failure', trace: process.env.CI ? 'retain-on-failure' : 'off' },
  webServer: {
    command: `npm run dev -- --port ${appPort}`, url: appUrl, reuseExistingServer: false, timeout: 120_000,
    env: {
      DATABASE_URL: '', APP_URL: appUrl, LOCAL_DATABASE_PATH: `.data/e2e-${process.pid}`,
      NEON_AUTH_BASE_URL: liveAuth?.baseUrl ?? '',
      NEON_AUTH_COOKIE_SECRET: 'ringgg-e2e-cookie-secret-for-isolated-local-tests-only',
      RESIDENT_EMAILS: liveAuth?.email ?? '',
      RESIDENT_ADMIN_EMAILS: '',
    },
  },
});
