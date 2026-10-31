import { HTTP } from '@/constants/doorbell';

/** A response the server rejected, with the `code` and `requestId` it sent so callers can react to the cause. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly requestId: string | undefined;

  constructor(message: string, status: number, code?: string, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

/** A string field of a failed response body, when the server sent one. */
function bodyField(body: unknown, field: 'error' | 'code' | 'requestId') {
  if (typeof body !== 'object' || body === null || !(field in body)) return undefined;
  const value: unknown = (body as Record<string, unknown>)[field];
  return typeof value === 'string' && value ? value : undefined;
}

/** Requests that change data (every call with `data`) still waiting for their answer. */
let mutationsInFlight = 0;

/** How many requests that change data are still running; reloading the page now would cut them off. */
export function pendingMutations() {
  return mutationsInFlight;
}

/**
 * Same-origin JSON client. Callers retain operation IDs when the network outcome is unknown. A call
 * with `data` is a change (POST) and counts in {@link pendingMutations} until its answer is read.
 */
export async function api<T>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  if (data === undefined) return request<T>(path, data, signal);
  mutationsInFlight += 1;
  try { return await request<T>(path, data, signal); }
  finally { mutationsInFlight -= 1; }
}

async function request<T>(path: string, data: unknown, signal: AbortSignal | undefined): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data), cache: 'no-store', signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = data === undefined
      ? 'No pudimos conectar con Ringgg. Revisá tu conexión a internet y volvé a intentar.'
      : 'No pudimos confirmar si se completó la acción. Revisá tu conexión y el estado actual antes de volver a intentar.';
    throw new Error(message, { cause: error });
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new ApiError(bodyField(body, 'error') ?? 'No pudimos conectar. Revisá tu conexión y reintentá.', response.status, bodyField(body, 'code'), bodyField(body, 'requestId'));
  }
  if (response.status === HTTP.noContent || response.headers.get('content-length') === '0') return undefined as T;
  const text = await response.text();
  return text ? JSON.parse(text) as T : undefined as T;
}
