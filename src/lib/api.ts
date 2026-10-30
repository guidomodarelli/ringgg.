import { HTTP } from '@/constants/doorbell';

/** The `error` message of a failed response body, when the server sent one. */
function serverErrorMessage(body: unknown) {
  if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' && body.error) return body.error;
  return 'No pudimos conectar. Revisá tu conexión y reintentá.';
}

/** Requests that change data (every call with `data`) still waiting for their answer. */
let mutationsInFlight = 0;
const settledListeners = new Set<() => void>();

/** How many requests that change data are still running; reloading the page now would cut them off. */
export function pendingMutations() {
  return mutationsInFlight;
}

/** Calls `listener` every time the last running change ends. Returns the function that stops it. */
export function onMutationsSettled(listener: () => void) {
  settledListeners.add(listener);
  return () => { settledListeners.delete(listener); };
}

function endMutation() {
  mutationsInFlight -= 1;
  if (mutationsInFlight === 0) for (const listener of settledListeners) listener();
}

/**
 * Same-origin JSON client. Callers retain operation IDs when the network outcome is unknown. A call
 * with `data` is a change (POST) and counts in {@link pendingMutations} until its answer is read.
 */
export async function api<T>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  if (data === undefined) return request<T>(path, data, signal);
  mutationsInFlight += 1;
  try { return await request<T>(path, data, signal); }
  finally { endMutation(); }
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
    throw new Error(serverErrorMessage(body));
  }
  if (response.status === HTTP.noContent || response.headers.get('content-length') === '0') return undefined as T;
  const text = await response.text();
  return text ? JSON.parse(text) as T : undefined as T;
}
