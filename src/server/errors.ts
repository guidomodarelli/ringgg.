import { HTTP } from '@/constants/doorbell';

/** Expected domain failures are safe to return to the browser. */
export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AppError';
  }
}

const LOG_LIMITS = { messageLength: 300, stackLines: 8, causeDepth: 3 };

/**
 * Technical summary of an error for logs: name, truncated message, driver code (for example a
 * PostgreSQL SQLSTATE), the top of the stack and the cause chain. Driver fields that can carry
 * row values or parameters (`detail`, `where`, `parameters`) are never copied.
 */
export function describeError(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error };
  const code = (error as { code?: unknown }).code;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return {
    name: error.name,
    message: error.message.slice(0, LOG_LIMITS.messageLength),
    ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
    ...(typeof statusCode === 'number' ? { statusCode } : {}),
    stack: error.stack?.split('\n').slice(1, LOG_LIMITS.stackLines + 1).map((line) => line.trim()),
    ...(error.cause !== undefined && depth < LOG_LIMITS.causeDepth ? { cause: describeError(error.cause, depth + 1) } : {}),
  };
}

/** One JSON line per failure, with the operation and only the identifiers the caller passes. */
export function logError(operation: string, error: unknown, context: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ level: 'error', operation, ...context, error: describeError(error) }));
}

/**
 * Keeps unexpected infrastructure errors and private request data out of API responses. Every
 * server-side failure is logged with its cause and correlated by the `requestId` the body returns.
 */
export function errorResponse(error: unknown, operation: string): Response {
  if (error instanceof AppError && error.status < HTTP.internal) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  const requestId = crypto.randomUUID();
  logError(operation, error, { requestId, ...(error instanceof AppError ? { code: error.code } : {}) });
  if (error instanceof AppError) return Response.json({ error: error.message, code: error.code, requestId }, { status: error.status });
  return Response.json({ error: `No pudimos completar la operación. Reintentá. Referencia: ${requestId}`, code: 'INTERNAL', requestId }, { status: HTTP.internal });
}
