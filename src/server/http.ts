import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { HTTP } from '@/constants/doorbell';
import { requireOrigin } from './auth';
import { AppError, errorResponse } from './errors';
import { parseJson } from './json';
import { forwardSetCookies, withRouteSession } from './session-cookies';

const BODY_LIMIT = 8192;

/** The raw body, for routes that verify a signature over the exact bytes they received. */
export async function readText(request: Request): Promise<string> {
  const text = await request.text();
  if (text.length > BODY_LIMIT) throw new AppError(HTTP.badRequest, 'BODY_LIMIT', 'La solicitud es demasiado grande.');
  return text;
}

export async function readJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  return parseJson(await readText(request), schema);
}

type Handler<Params> = (request: NextRequest, params: Params) => Promise<Response>;

/**
 * `checkOrigin: false` is only for requests that never come from a browser and prove who sent them
 * another way, such as the chat Worker's signed notifications.
 */
interface ApiRouteOptions { checkOrigin?: boolean }

/**
 * Shared envelope for every API route: Origin check on mutations, no-store responses and
 * safe error bodies. Each route still authenticates on its own before opening private data.
 * Session cookies renewed while it does go out with the response, also when the route then fails.
 */
export function apiRoute<Params = Record<string, never>>(operation: string, handler: Handler<Params>, { checkOrigin = true }: ApiRouteOptions = {}) {
  return async (request: NextRequest, context: { params: Promise<Params> }) => {
    const session = { requestHeaders: request.headers, responseCookies: new Headers() };
    let response: Response;
    try {
      if (checkOrigin && request.method !== 'GET' && request.method !== 'HEAD') requireOrigin(request);
      const params = await context.params;
      response = await withRouteSession(session, () => handler(request, params));
    } catch (error) {
      response = error instanceof z.ZodError
        ? Response.json({ error: 'Revisá los datos ingresados.', code: 'INVALID_INPUT' }, { status: HTTP.badRequest })
        : errorResponse(error, `${request.method} api.${operation}`);
    }
    forwardSetCookies(session.responseCookies, response.headers);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };
}
