import { redirect } from 'next/navigation';
import type { ResidentIdentity } from '@/types/auth';
import { getIdentity } from './auth';
import { getDatabase, type Database } from './database';

/**
 * The signed-in resident and the app database for a private page, or a redirect to sign in. A cold
 * instance opens both connections (auth and app) at the same time instead of one after the other. A
 * visitor without a session still goes to sign in even if the database failed meanwhile.
 */
export async function identityWithDatabase(): Promise<[ResidentIdentity, Database]> {
  const database = getDatabase();
  let user: ResidentIdentity | null;
  try { user = await getIdentity(); }
  catch (error) { database.catch(() => undefined); throw error; }
  if (!user) {
    database.catch(() => undefined);
    redirect('/sign-in');
  }
  return [user, await database];
}
