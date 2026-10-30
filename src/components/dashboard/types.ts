/**
 * How a dashboard action reconciles local state once the server confirms it:
 * - `snapshot`: the response is a full dashboard snapshot (settings, quiet hours, QR rotation).
 * - `visit`: the response is the stored visit; it replaces that visit in the history.
 * - `refetch`: the response carries no state, so a fresh snapshot is requested (default).
 * - `none`: the action does not change dashboard data (test notifications, sign out).
 */
export type Reconcile = 'snapshot' | 'visit' | 'refetch' | 'none';

/** Runs one server-confirmed dashboard action; resolves `true` once the server confirms it and local state is reconciled. `success` may derive the message from the server result. */
export type RunAction = (key: string, work: () => Promise<unknown>, success: string | ((result: unknown) => string), reconcile?: Reconcile) => Promise<boolean>;
