'use client';
import { createAuthClient } from 'better-auth/react';
import { oneTapClient } from 'better-auth/client/plugins';
import type { BetterAuthClientPlugin } from 'better-auth/client';

export function createSelfAuthClient(clientId: string) {
  const plugin = oneTapClient({ clientId, autoSelect: false, additionalOptions: { itp_support: true } });
  // Better Auth 1.7.14 exposes incompatible BetterFetch generics between its own
  // plugin and client types; preserve the actual plugin action signature.
  const client = createAuthClient({ plugins: [plugin as unknown as BetterAuthClientPlugin] });
  return client as typeof client & { oneTap: ReturnType<typeof plugin.getActions>['oneTap'] };
}
