import { AUTH } from '@/constants/auth';
import { DATABASE } from '@/constants/database';
import type { ResidentAccount, ResidentRosterEntry } from '@/types/residents';
import { isSelfManagedAuth } from './auth-mode';
import type { Database } from './database';
import { logError } from './errors';
import { listResidents, residentSettings } from './residents';
import { getSelfAuth } from './self-auth';

/** Whether each email with an account verified it, by lowercase email. */
export type AccountVerification = Map<string, boolean>;
/** Reads the accounts of some emails from an auth provider; `null` when this server cannot read them. */
export type AccountLookup = (emails: string[]) => Promise<AccountVerification | null>;

/** Neon Auth accounts live in `neon_auth` of the app database; a database without that schema (local tests) has none to read. */
export function managedAccounts(database: Database): AccountLookup {
  return async (emails) => {
    try {
      const result = await database.query<{ email: string; verified: boolean }>(
        `SELECT lower(email) AS email, "emailVerified" AS verified FROM ${AUTH.managedSchema}."user" WHERE lower(email) = ANY($1::text[])`,
        [emails],
      );
      return new Map(result.rows.map((account) => [account.email, account.verified]));
    } catch (error) {
      if ((error as { code?: unknown }).code === DATABASE.undefinedTableCode) return null;
      throw error;
    }
  };
}

/** Self-managed accounts, read through Better Auth's adapter, which knows their schema and stores emails in lowercase. */
export const selfManagedAccounts: AccountLookup = async (emails) => {
  const context = await getSelfAuth().$context;
  const users = await context.adapter.findMany<{ email: string; emailVerified: boolean }>({ model: 'user', where: [{ field: 'email', operator: 'in', value: emails }] });
  return new Map(users.map((user) => [user.email.toLowerCase(), user.emailVerified]));
};

/** The accounts of the auth provider this deployment signs residents in with. */
export function providerAccounts(database: Database): AccountLookup {
  return isSelfManagedAuth() ? selfManagedAccounts : managedAccounts(database);
}

function accountOf(verification: AccountVerification, email: string): ResidentAccount {
  const verified = verification.get(email);
  if (verified === undefined) return 'missing';
  return verified ? 'verified' : 'unverified';
}

/**
 * The residents of a home and the state of their accounts, so the panel shows who still has to sign up or
 * verify. If the provider fails to answer, the roster still loads with unknown states and the failure is logged.
 */
export async function listResidentRoster(database: Database, homeId: number, settings = residentSettings(), lookup = providerAccounts(database)): Promise<ResidentRosterEntry[]> {
  const roster = await listResidents(database, homeId, settings);
  const verification = await lookup(roster.map((resident) => resident.email)).catch((error: unknown) => {
    logError('residents.accounts', error, { homeId, residents: roster.length });
    return null;
  });
  return roster.map((resident) => ({ ...resident, account: verification ? accountOf(verification, resident.email) : null }));
}
