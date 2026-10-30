import { apiRoute } from '@/server/http';
import type { AppVersion } from '@/types/app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Public on purpose: it only names the deployment, set once per build in `next.config.ts`. */
export const GET = apiRoute('version', () => Promise.resolve(Response.json({ version: process.env.APP_VERSION ?? '' } satisfies AppVersion)));
