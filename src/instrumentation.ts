import type { Instrumentation } from 'next';
import { logError } from './server/errors';

/**
 * Render and route errors that no handler caught, with their cause. The route file path replaces
 * the request path, so the public doorbell token of `/t/<token>` never reaches the logs.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const digest = typeof error === 'object' && error !== null && 'digest' in error ? String(error.digest) : undefined;
  logError('next.request', error, { method: request.method, routePath: context.routePath, routeType: context.routeType, digest });
};
