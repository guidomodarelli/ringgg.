'use client';
import { createAuthClient } from 'better-auth/react';
import { oneTapClient } from 'better-auth/client/plugins';

/** Better Auth client with Google One Tap; its type keeps the plugin's `oneTap` action and the core sign-in actions. */
export function createSelfAuthClient(clientId: string) {
  return createAuthClient({ plugins: [oneTapClient({ clientId, autoSelect: false, additionalOptions: { itp_support: true } })] });
}
