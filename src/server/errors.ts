import { HTTP } from '@/constants/doorbell';

/** Expected domain failures are safe to return to the browser. */
export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AppError';
  }
}

/** Keeps unexpected infrastructure errors and private request data out of API responses. */
export function errorResponse(error: unknown, operation: string): Response {
  if (error instanceof AppError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  const requestId = crypto.randomUUID();
  console.error(JSON.stringify({ operation, requestId, errorType: error instanceof Error ? error.name : 'UnknownError' }));
  return Response.json({ error: `No pudimos completar la operación. Reintentá. Referencia: ${requestId}`, code: 'INTERNAL', requestId }, { status: HTTP.internal });
}
