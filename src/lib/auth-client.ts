'use client';
import { createAuthClient } from '@neondatabase/auth/next';

/** Managed Neon client always talks to the same-origin auth proxy. */
export const authClient = createAuthClient();
