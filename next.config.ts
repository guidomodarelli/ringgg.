import type { NextConfig } from 'next';
import { assertDeployEnvironment } from './src/server/environment';

// A production build with a missing variable fails here, so the previous deployment keeps serving.
assertDeployEnvironment();

// One value per build: open apps compare it with /api/version to notice a new deployment. Empty
// Vercel variables fall through on purpose, and a local build gets its own timestamp.
const APP_VERSION = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || new Date().toISOString();

const nextConfig: NextConfig = {
  env: { APP_VERSION },
  outputFileTracingExcludes: { '*': ['./.data/**/*', './test-results/**/*', './playwright-report/**/*'] },
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'web-push'],
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
    ] }, { source: '/sw.js', headers: [
      { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
      { key: 'Service-Worker-Allowed', value: '/' },
    ] }];
  },
};
export default nextConfig;
