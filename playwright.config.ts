import { defineConfig } from '@playwright/test';
export default defineConfig({
  timeout: 60_000,
  testDir: './tests/e2e', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://localhost:3100', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev -- --port 3100', url: 'http://localhost:3100', reuseExistingServer: false, timeout: 120_000,
    env: { ADMIN_PASSWORD: 'ringgg-test-password-only', SESSION_SECRET: 'ringgg-e2e-session-secret-for-local-tests-only', APP_URL: 'http://localhost:3100', LOCAL_DATABASE_PATH: `.data/e2e-${process.pid}` },
  },
});
