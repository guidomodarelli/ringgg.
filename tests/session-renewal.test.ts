import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { NextRequest } from 'next/server';
import { getMigrations } from 'better-auth/db/migration';
import { serializeSignedCookie } from 'better-call';
import type { Dialect } from 'kysely';
import { AUTH } from '../src/constants/auth';
import { ERROR_CODES } from '../src/constants/error-codes';
import { HOMES } from '../src/constants/homes';
import { TIME } from '../src/constants/time';
import { getDatabase } from '../src/server/database';
import { getSelfAuth } from '../src/server/self-auth';
import { GET as getDashboard } from '../src/app/api/dashboard/route';
import { POST as postPushReceipt } from '../src/app/api/push-receipt/route';
import { pushSubscription } from './support/push-subscription';
import { servePglite } from './support/pglite-server';

// Real route handlers, Better Auth, `pg` driver and PostgreSQL (PGlite behind the wire protocol); only the clock is simulated.
const APP_URL = 'http://localhost:3000';
const RESIDENT_EMAIL = 'residente@example.com';
const START_MS = Date.UTC(2026, 0, 5, 12);
const LIFETIME_MS = AUTH.sessionLifetimeSeconds * TIME.secondMs;
const RENEWAL_MS = AUTH.sessionRenewalSeconds * TIME.secondMs;
const NO_PARAMS = { params: Promise.resolve({}) };

// One database for the app and, in its own schema, the auth server: the layout production can use.
const postgres = new PGlite();
let server: { url: string; close: () => Promise<void> } | undefined;
let residentId = '';

beforeAll(async () => {
  server = await servePglite(postgres);
  vi.stubEnv('AUTH_PROVIDER', 'self');
  vi.stubEnv('APP_URL', APP_URL);
  vi.stubEnv('SELF_AUTH_SECRET', 'ringgg-session-renewal-test-secret-only');
  vi.stubEnv('SELF_AUTH_DATABASE_URL', server.url);
  vi.stubEnv('GOOGLE_CLIENT_ID', 'ringgg-test-client');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'ringgg-test-client-secret');
  vi.stubEnv('DATABASE_URL', server.url);
  vi.stubEnv('RESIDENT_EMAILS', RESIDENT_EMAIL);
  await (await getMigrations(getSelfAuth().options)).runMigrations();
  const context = await getSelfAuth().$context;
  // The account Google sign-in would provision, created directly: the test is about the session, not OAuth.
  residentId = (await context.internalAdapter.createUser({ email: RESIDENT_EMAIL, name: 'Residente', emailVerified: true }, { method: 'admin' })).id;
}, 60_000);
afterEach(() => { vi.useRealTimers(); });
afterAll(async () => {
  // Both pools end their connections first, as on a shutdown, so closing the servers drops none in use.
  const { dialect } = getSelfAuth().options.database as { dialect: Dialect };
  const authDriver = dialect.createDriver();
  await authDriver.init();
  await Promise.all([authDriver.destroy(), getDatabase().then((database) => database.close?.())]);
  await server?.close();
  await postgres.close();
  vi.unstubAllEnvs();
});

/** Moves the server clock, as days pass between the app's requests. */
function at(timeMs: number) {
  vi.setSystemTime(timeMs);
}

/** A session of the resident started now, as signing in with Google leaves it, and the cookie the browser holds for it. */
async function signIn() {
  const context = await getSelfAuth().$context;
  const session = await context.internalAdapter.createSession(residentId);
  const cookieName = context.authCookies.sessionToken.name;
  const signed = await serializeSignedCookie(cookieName, session.token, context.secret);
  return { token: session.token, cookieName, cookie: signed.split(';')[0] };
}

/** The session cookie a response sets, as the browser keeps it, or `null` when it sets none. */
function sessionCookieSet(response: Response, cookieName: string) {
  const header = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${cookieName}=`));
  return header ? { cookie: header.split(';')[0], maxAgeSeconds: Number(/Max-Age=(\d+)/i.exec(header)?.[1]) } : null;
}

/** When the stored session ends, or `null` once Better Auth deleted it. */
async function storedExpiry(token: string) {
  const result = await postgres.query<{ expiresAt: Date }>(`SELECT "expiresAt" FROM ${AUTH.selfManagedDefaultSchema}.session WHERE token = $1`, [token]);
  return result.rows[0]?.expiresAt.getTime() ?? null;
}

/** The panel's polling request. */
function pollDashboard(cookie: string) {
  return getDashboard(new NextRequest(`${APP_URL}/api/dashboard?${HOMES.queryParameter}=${HOMES.originalId}`, { headers: { cookie } }), NO_PARAMS);
}

/** The receipt the service worker sends when a push arrives, with no window open. */
function sendPushReceipt(cookie: string) {
  const body = JSON.stringify({ endpoint: pushSubscription('session-renewal').endpoint, visitId: null });
  return postPushReceipt(new NextRequest(`${APP_URL}/api/push-receipt`, { method: 'POST', headers: { cookie, origin: APP_URL, 'content-type': 'application/json' }, body }), NO_PARAMS);
}

describe('sesión propia renovada por las rutas de la API', () => {
  test('una sesión que solo usa la API se extiende al pasar updateAge y sigue valiendo después de su vida original', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(START_MS);
    const resident = await signIn();
    expect(await storedExpiry(resident.token)).toBe(START_MS + LIFETIME_MS);

    // Before `updateAge` the route reads the session without writing it again.
    at(START_MS + RENEWAL_MS / 2);
    const early = await pollDashboard(resident.cookie);
    expect(early.status).toBe(200);
    expect(sessionCookieSet(early, resident.cookieName)).toBeNull();
    expect(await storedExpiry(resident.token)).toBe(START_MS + LIFETIME_MS);

    // A push receipt from the service worker is enough to renew it: the response carries the new cookie.
    const renewedAt = START_MS + 2 * RENEWAL_MS;
    at(renewedAt);
    const receipt = await sendPushReceipt(resident.cookie);
    expect(receipt.status).toBe(200);
    expect(await receipt.json()).toEqual({ recorded: false });
    const renewed = sessionCookieSet(receipt, resident.cookieName);
    expect(renewed).toEqual({ cookie: resident.cookie, maxAgeSeconds: AUTH.sessionLifetimeSeconds });
    expect(await storedExpiry(resident.token)).toBe(renewedAt + LIFETIME_MS);

    // Past the original 30 days the panel still opens its home with that cookie.
    at(START_MS + LIFETIME_MS + RENEWAL_MS);
    const later = await pollDashboard(renewed?.cookie ?? '');
    expect(later.status).toBe(200);
    expect((await later.json()).home.id).toBe(HOMES.originalId);
  }, 30_000);

  test('una sesión sin uso vence a los 30 días: la ruta responde que hay que ingresar y borra la cookie', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(START_MS);
    const resident = await signIn();
    at(START_MS + LIFETIME_MS + RENEWAL_MS);
    const expired = await pollDashboard(resident.cookie);
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ code: ERROR_CODES.authRequired });
    expect(sessionCookieSet(expired, resident.cookieName)?.maxAgeSeconds).toBe(0);
    expect(await storedExpiry(resident.token)).toBeNull();
  }, 30_000);
});
