import { AsyncLocalStorage } from 'node:async_hooks';

/** Copies every `Set-Cookie` of an auth response, keeping each cookie as its own header. */
export function forwardSetCookies(source: Headers, target: Headers) {
  for (const cookie of source.getSetCookie()) target.append('set-cookie', cookie);
  return target;
}

/** The request an API route is answering and the session cookies its response has to carry. */
export interface RouteSession { requestHeaders: Headers; responseCookies: Headers }

const routeSessions = new AsyncLocalStorage<RouteSession>();

/**
 * Runs an API route handler where checking the session may also renew it: the renewed cookies are
 * collected in `responseCookies` for the route's response. Pages render outside this scope, since
 * server components cannot write cookies.
 */
export function withRouteSession<T>(session: RouteSession, work: () => Promise<T>): Promise<T> {
  return routeSessions.run(session, work);
}

/** The API route being answered, or `undefined` while a page renders. */
export function currentRouteSession(): RouteSession | undefined {
  return routeSessions.getStore();
}
