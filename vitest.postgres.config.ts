import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config.js';
import { POSTGRES_SKIP_REASON, TEST_POSTGRES_URL } from './tests/support/postgres-environment.js';

/** A cold Neon compute takes seconds to wake up, and each file migrates a schema of its own before its tests. */
const POSTGRES_TIMEOUTS = { testMs: 60_000, hookMs: 120_000 };

if (!TEST_POSTGRES_URL) console.warn(POSTGRES_SKIP_REASON);

/**
 * The suite against a real PostgreSQL (`npm run test:postgres`), where locks are contended for real; `npm test`
 * never includes it. Files run one at a time, so a lock a test holds only has that test's requests queued behind it.
 */
export default defineConfig({
  ...baseConfig,
  test: { ...baseConfig.test, include: ['tests/postgres/*.test.ts'], fileParallelism: false, testTimeout: POSTGRES_TIMEOUTS.testMs, hookTimeout: POSTGRES_TIMEOUTS.hookMs },
});
