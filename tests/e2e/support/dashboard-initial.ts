import type { Database } from '../../../src/server/database';
import { snapshot } from '../../../src/server/doorbell';
import { HOMES } from '../../../src/constants/homes';
import type { DashboardData } from '../../../src/types/doorbell';

/** The original home, where the dashboard fixtures run. */
export const FIXTURE_HOME = HOMES.originalId;

/**
 * What the panel page passes to `Dashboard`: the home's snapshot plus a resident who already chose
 * their name there and has only this home. `overrides` replaces any of it.
 */
export async function dashboardInitial(database: Database, overrides: Partial<DashboardData> = {}): Promise<DashboardData> {
  const state = await snapshot(database, FIXTURE_HOME);
  return {
    ...state, pushReady: false, origin: 'http://127.0.0.1',
    viewer: { name: 'Guido', suggestedName: 'Guido', email: 'guido@example.com' },
    homes: [{ id: state.home.id, name: state.home.name }], residents: [],
    ...overrides,
  };
}

/** Path of an API request without its query, so `dashboard?home=1` and `dashboard` both read as `dashboard`. */
export function apiPath(url: string) {
  return new URL(url, 'http://127.0.0.1').pathname.replace(/^\/api\//, '');
}
