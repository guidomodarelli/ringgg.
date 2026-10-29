import type { NextRequest } from 'next/server';
import { getNeonAuth } from '@/server/neon-auth';
import { errorResponse } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The managed SDK owns cookie, CSRF, OAuth, and session handling. */
async function handler(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
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
