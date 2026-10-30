import { HTTP } from '@/constants/doorbell';

/** The `error` message of a failed response body, when the server sent one. */
function serverErrorMessage(body: unknown) {
  if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' && body.error) return body.error;
  return 'No pudimos conectar. Revisá tu conexión y reintentá.';
}

/** Same-origin JSON client. Callers retain operation IDs when the network outcome is unknown. */
export async function api<T>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
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
