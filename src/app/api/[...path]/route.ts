import { HTTP } from '@/constants/doorbell';
import { AppError } from '@/server/errors';
import { apiRoute } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Every operation has its own route handler; unknown paths keep a JSON error body. */
const notFound = apiRoute<{ path: string[] }>('unknown', async () => { throw new AppError(HTTP.notFound, 'ROUTE_NOT_FOUND', 'No encontramos esta operación.'); });
export const GET = notFound;
export const POST = notFound;
