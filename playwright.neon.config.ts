import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

/** Explicit live test: creates and removes one synthetic account; never changes home settings. */
export default defineConfig({
  testDir: './tests/neon', workers: 1, timeout: 90_000,
  use: { baseURL: process.env.APP_URL || 'http://localhost:3000', reducedMotion: 'reduce' },
});
