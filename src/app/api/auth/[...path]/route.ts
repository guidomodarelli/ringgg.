import type { NextRequest } from 'next/server';
import { getNeonAuth } from '@/server/neon-auth';
import { errorResponse } from '@/server/errors';
import { isSelfManagedAuth } from '@/server/auth-mode';
import { getSelfAuth } from '@/server/self-auth';
import { toNextJsHandler } from 'better-auth/next-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The managed SDK owns cookie, CSRF, OAuth, and session handling. */
async function handler(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    if (isSelfManagedAuth()) {
      if (request.method !== 'GET' && request.method !== 'POST') return new Response(null, { status: 405 });
      const response = await toNextJsHandler(getSelfAuth())[request.method](request);
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    const handlers = getNeonAuth().handler();
    const response = await handlers[request.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'](request, context);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) { return errorResponse(error, 'auth.proxy'); }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
