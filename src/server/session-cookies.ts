/** Copies every `Set-Cookie` of an auth response, keeping each cookie as its own header. */
export function forwardSetCookies(source: Headers, target: Headers) {
  for (const cookie of source.getSetCookie()) target.append('set-cookie', cookie);
  return target;
}
