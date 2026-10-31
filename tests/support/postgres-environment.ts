/**
 * The real PostgreSQL the suite in `tests/postgres` runs against; without it, the suite is skipped. Kept apart from
 * the suite's helpers so the Vitest config reads it without loading the app.
 */
export const TEST_POSTGRES_URL = process.env.TEST_POSTGRES_URL;
export const POSTGRES_SKIP_REASON = 'TEST_POSTGRES_URL no está definida: la suite contra PostgreSQL real (tests/postgres) se saltea.';
