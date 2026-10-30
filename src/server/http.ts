import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { HTTP } from '@/constants/doorbell';
import { requireOrigin } from './auth';
import { AppError, errorResponse } from './errors';

const BODY_LIMIT = 8192;

export async function readJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  const text = await request.text();
  if (text.length > BODY_LIMIT) throw new AppError(HTTP.badRequest, 'BODY_LIMIT', 'La solicitud es demasiado grande.');
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { throw new AppError(HTTP.badRequest, 'INVALID_JSON', 'La solicitud no tiene un formato válido.', { cause: error }); }
  return schema.parse(value);
}

type Handler<Params> = (request: NextRequest, params: Params) => Promise<Response>;

/**
 * Shared envelope for every API route: Origin check on mutations, no-store responses and
 * safe error bodies. Each route still authenticates on its own before opening private data.
 */
export function apiRoute<Params = Record<string, never>>(operation: string, handler: Handler<Params>) {
  return async (request: NextRequest, context: { params: Promise<Params> }) => {
    let response: Response;
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') requireOrigin(request);
      response = await handler(request, await context.params);
    } catch (error) {
      response = error instanceof z.ZodError
        ? Response.json({ error: 'Revisá los datos ingresados.', code: 'INVALID_INPUT' }, { status: HTTP.badRequest })
        : errorResponse(error, `${request.method} api.${operation}`);
    }
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };
}
