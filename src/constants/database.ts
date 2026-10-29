/** Small per-instance pools complement Neon's server-side transaction pooler. */
export const DATABASE = {
  poolMax: 3,
  connectionTimeoutMs: 15_000,
  idleTimeoutMs: 10_000,
  maxLifetimeSeconds: 300,
  applicationName: 'ringgg',
  neonSuffix: '.neon.tech',
  verifiedSslMode: 'verify-full',
};
