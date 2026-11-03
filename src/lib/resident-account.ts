import type { ResidentAccount } from '@/types/residents';

export type ResidentAccountTone = 'ok' | 'warning';

/** What Residents says about each account state: a resident without an account or a verified email cannot open the home yet. */
const ACCOUNT_NOTICES = {
  verified: { tone: 'ok', text: 'Correo verificado' },
  unverified: { tone: 'warning', text: 'Creó su cuenta, pero falta que verifique el correo' },
  missing: { tone: 'warning', text: 'Todavía no creó su cuenta con este correo' },
} satisfies Record<ResidentAccount, { tone: ResidentAccountTone; text: string }>;

/** The account line of a resident, or `null` when the server could not read the auth provider's accounts. */
export function residentAccountNotice(account: ResidentAccount | null): { tone: ResidentAccountTone; text: string } | null {
  return account ? ACCOUNT_NOTICES[account] : null;
}
