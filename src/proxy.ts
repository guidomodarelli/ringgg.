import { NextResponse, type NextRequest } from 'next/server';
import { HOMES } from '@/constants/homes';
import { authConfigured, getNeonAuth } from '@/server/neon-auth';
import { isSelfManagedAuth } from '@/server/auth-mode';
import { logError } from '@/server/errors';

const HOME_ID_PATTERN = /^\d+$/;

/**
 * `?home=<id>` is remembered so `/` reopens the last home. Only a number is stored; the page still
 * checks that the resident can open that home before using it.
 */
function rememberHome(request: NextRequest, response: Response) {
  const homeId = request.nextUrl.searchParams.get(HOMES.queryParameter);
  // A redirect (to sign in) does not open a home, and its headers may be immutable.
  if (!homeId || !HOME_ID_PATTERN.test(homeId) || response.headers.has('location')) return response;
  const secure = request.nextUrl.protocol === 'https:' ? '; Secure' : '';
  try { response.headers.append('set-cookie', `${HOMES.cookieName}=${homeId}; Path=/; Max-Age=${HOMES.cookieMaxAgeSeconds}; SameSite=Lax; HttpOnly${secure}`); }
  catch (error) { logError('proxy.rememberHome', error); }
  return response;
}

/**
 * Neon Auth renews its session here, where Next.js permits updating response cookies. The self-managed
 * session is renewed by the API routes the open panel calls (its polling, receipts, device checks), so the
 * proxy does not wait for the database: until the proxy answers nothing reaches the screen, not even the
 * loading skeleton.
 */
export default async function proxy(request: NextRequest) {
  if (!authConfigured() || isSelfManagedAuth()) return rememberHome(request, NextResponse.next());
  return rememberHome(request, await getNeonAuth().middleware({ loginUrl: '/sign-in' })(request));
}

export const config = { matcher: ['/', '/cartel'] };
