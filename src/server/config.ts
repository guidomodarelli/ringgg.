import webpush from 'web-push';

interface LocalSecrets { publicKey: string; privateKey: string }
const configGlobal = globalThis as unknown as { ringggLocalSecrets?: LocalSecrets };

/** Push credentials can be generated for development; identity always belongs to Neon Auth. */
export function getConfig() {
  const local = process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
  if (local && !configGlobal.ringggLocalSecrets) {
    const keys = webpush.generateVAPIDKeys();
    configGlobal.ringggLocalSecrets = { publicKey: keys.publicKey, privateKey: keys.privateKey };
  }
  return {
    origin: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
    publicKey: process.env.VAPID_PUBLIC_KEY || configGlobal.ringggLocalSecrets?.publicKey || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || configGlobal.ringggLocalSecrets?.privateKey || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  };
}
