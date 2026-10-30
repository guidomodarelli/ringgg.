import type { NextConfig } from 'next';
import { assertDeployEnvironment } from './src/server/environment';

// A production build with a missing variable fails here, so the previous deployment keeps serving.
assertDeployEnvironment();

const nextConfig: NextConfig = {
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
