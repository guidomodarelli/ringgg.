import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AppError } from '../../../src/server/errors';
import { bundleFixture } from './bundle-fixture';
import { readText } from './read-text';

/** Answers one `/api/` request of a fixture and returns `true`, or `false` to answer 404. */
export type FixtureApi = (request: IncomingMessage, response: ServerResponse, path: string) => Promise<boolean>;

/** The JSON body of a request to a fixture server. */
export async function readBody(request: IncomingMessage) {
  return JSON.parse(await readText(request) || '{}');
}

/** Like the app's error responses: an expected failure keeps its message and code, anything else says nothing. */
function sendError(response: ServerResponse, error: unknown) {
  response.statusCode = error instanceof AppError ? error.status : 500;
  response.end(JSON.stringify(error instanceof AppError ? { error: error.message, code: error.code } : { error: 'No se pudo completar la prueba.' }));
}

/**
 * Serves a component fixture on its own port (so each test gets its own origin and browser storage): the page runs
 * `inject` and then the bundle of `entry`, and every `/api/` request goes to `api`.
 */
export async function serveFixture(entry: string, inject: string, api: FixtureApi) {
  const bundled = await bundleFixture(entry);
  async function answer(request: IncomingMessage, response: ServerResponse) {
    const path = request.url || '/';
    if (path === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled); return; }
    if (path.startsWith('/api/')) { response.setHeader('Content-Type', 'application/json'); try { if (await api(request, response, path.slice(5))) return; response.statusCode = 404; response.end('{}'); } catch (error) { sendError(response, error); } return; }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><body><div id="root"></div><script>${inject}</script><script src="/bundle.js"></script></body></html>`);
  }
  const server = createServer((request, response) => { void answer(request, response); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a TCP port');
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
