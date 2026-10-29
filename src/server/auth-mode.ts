/** Managed authentication remains the default until the tested cutover is explicitly configured. */
export function isSelfManagedAuth(): boolean { return process.env.AUTH_PROVIDER === 'self'; }
