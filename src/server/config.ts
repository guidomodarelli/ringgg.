import { randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { SESSION } from '@/constants/doorbell';

interface LocalSecrets { password: string; secret: string; publicKey: string; privateKey: string }
const configGlobal = globalThis as unknown as { ringggLocalSecrets?: LocalSecrets };

/** Development credentials are random per server process and never accepted in production. */
export function getConfig() {
  const local = process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
  if (local && !configGlobal.ringggLocalSecrets) {
    const keys = webpush.generateVAPIDKeys();
    configGlobal.ringggLocalSecrets = { password: randomBytes(18).toString('base64url'), secret: randomBytes(32).toString('hex'), publicKey: keys.publicKey, privateKey: keys.privateKey };
    if (!process.env.ADMIN_PASSWORD) console.info(`\nRinggg · clave local de acceso: ${configGlobal.ringggLocalSecrets.password}\n`);
  }
  const password = process.env.ADMIN_PASSWORD || configGlobal.ringggLocalSecrets?.password;
  const secret = process.env.SESSION_SECRET || configGlobal.ringggLocalSecrets?.secret;
  if (!password || password.length < SESSION.minimumPasswordLength || !secret || secret.length < 32) throw new Error('Config: set ADMIN_PASSWORD (12+ characters) and SESSION_SECRET (32+ characters)');
  return {
    password, secret,
    origin: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
    publicKey: process.env.VAPID_PUBLIC_KEY || configGlobal.ringggLocalSecrets?.publicKey || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || configGlobal.ringggLocalSecrets?.privateKey || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  };
}
