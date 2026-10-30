import type { IncomingMessage } from 'node:http';

/** Reads the whole body of a request to a fixture server. */
export async function readText(request: IncomingMessage) {
  let text = '';
  for await (const chunk of request) text += String(chunk);
  return text;
}
