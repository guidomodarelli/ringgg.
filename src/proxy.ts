import { NextResponse, type NextRequest } from 'next/server';
import { authConfigured, getNeonAuth } from '@/server/neon-auth';
import { isSelfManagedAuth } from '@/server/auth-mode';

/** Session renewal happens in the proxy, where Next.js permits updating response cookies. */
export default async function proxy(request: NextRequest) {
  if (!authConfigured() || isSelfManagedAuth()) return NextResponse.next();
  return getNeonAuth().middleware({ loginUrl: '/sign-in' })(request);
}

export const config = { matcher: ['/'] };
