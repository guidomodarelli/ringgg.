import { cookies } from 'next/headers';
import { HOMES } from '@/constants/homes';
import type { ResidentIdentity } from '@/types/auth';
import type { HomeSummary } from '@/types/residents';
import type { Database } from './database';
import { homeIdSchema } from './homes';
import { listResidentHomes } from './residents';

function parseHomeId(value: string | undefined) {
  const parsed = homeIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The home a page opens: the one in `?home=`, else the last one opened, else the resident's first
 * home. A home the resident cannot open is never chosen; `null` means the resident has no home.
 */
export function pickPanelHome(homes: HomeSummary[], requested: string | undefined, remembered: string | undefined): number | null {
  const candidates = [parseHomeId(requested), parseHomeId(remembered)];
  const chosen = candidates.find((candidate) => homes.some((home) => home.id === candidate));
  if (chosen) return chosen;
  return homes.length ? homes[0].id : null;
}

/** `pickPanelHome` with the resident's homes and the cookie the proxy sets when a home is opened. */
export async function choosePanelHome(database: Database, user: ResidentIdentity, requested: string | undefined): Promise<{ homes: HomeSummary[]; homeId: number | null }> {
  const homes = await listResidentHomes(database, user);
  const remembered = (await cookies()).get(HOMES.cookieName)?.value;
  return { homes, homeId: pickPanelHome(homes, requested, remembered) };
}
