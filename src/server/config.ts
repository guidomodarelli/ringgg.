import webpush from 'web-push';
import { LOCAL_DEFAULTS } from '../constants/environment';
import type { Environment } from '../types/environment';

interface LocalSecrets { publicKey: string; privateKey: string }
const configGlobal = globalThis as unknown as { ringggLocalSecrets?: LocalSecrets };

function httpsOrigin(host: string | undefined) {
  return host ? `https://${host}` : '';
}

/**
 * Public origin, the origins allowed to send mutations and the push credentials. A Vercel preview
 * without `APP_URL` uses its branch URL and also accepts its deployment URL. Deployments never fall
 * back to localhost or to placeholder push credentials; only a developer machine generates them.
 */
export function getConfig(env: Environment = process.env) {
  const deployed = Boolean(env.VERCEL);
  const previewOrigins = env.VERCEL_ENV === 'preview' ? [httpsOrigin(env.VERCEL_BRANCH_URL), httpsOrigin(env.VERCEL_URL)].filter(Boolean) : [];
  const origin = env.APP_URL?.replace(/\/$/, '') || previewOrigins[0] || (deployed ? '' : LOCAL_DEFAULTS.origin);
  if (!origin) throw new Error('Config:getConfig failed: APP_URL is required on this deployment');
  const local = !deployed && env.NODE_ENV !== 'production';
  if (local && !configGlobal.ringggLocalSecrets) {
    const keys = webpush.generateVAPIDKeys();
    configGlobal.ringggLocalSecrets = { publicKey: keys.publicKey, privateKey: keys.privateKey };
  }
  return {
    origin,
    allowedOrigins: [...new Set([new URL(origin).origin, ...previewOrigins])],
    publicKey: env.VAPID_PUBLIC_KEY || (local ? configGlobal.ringggLocalSecrets?.publicKey ?? '' : ''),
    privateKey: env.VAPID_PRIVATE_KEY || (local ? configGlobal.ringggLocalSecrets?.privateKey ?? '' : ''),
    subject: env.VAPID_SUBJECT || (local ? LOCAL_DEFAULTS.vapidSubject : ''),
  };
}

/** Push is ready only with a complete VAPID identity. */
export function pushConfigured(config: ReturnType<typeof getConfig>) {
  return Boolean(config.publicKey && config.privateKey && config.subject);
}
