import { NextResponse, type NextRequest } from 'next/server';
import { HOMES } from '@/constants/homes';
import { authConfigured, getNeonAuth } from '@/server/neon-auth';
import { isSelfManagedAuth } from '@/server/auth-mode';
import { getSelfAuth } from '@/server/self-auth';
import { forwardSetCookies } from '@/server/session-cookies';
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
 * Better Auth extends a session that is old enough and answers with fresh cookies. Pages cannot
 * write cookies, so the proxy forwards them; if the check fails, the page still decides access.
 */
async function renewSelfManagedSession(request: NextRequest) {
  const response = NextResponse.next();
  try {
    const { headers } = await getSelfAuth().api.getSession({ headers: request.headers, returnHeaders: true });
    forwardSetCookies(headers, response.headers);
  } catch (error) { logError('proxy.renewSelfManagedSession', error); }
  return response;
}

/** Session renewal happens in the proxy, where Next.js permits updating response cookies. */
export default async function proxy(request: NextRequest) {
  if (!authConfigured()) return rememberHome(request, NextResponse.next());
  if (isSelfManagedAuth()) return rememberHome(request, await renewSelfManagedSession(request));
  return rememberHome(request, await getNeonAuth().middleware({ loginUrl: '/sign-in' })(request));
}

export const config = { matcher: ['/', '/cartel'] };
