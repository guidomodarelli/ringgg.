/** Visitor page: how often it checks for an answer while waiting, and for availability while the bell is off. */
export const VISITOR_POLLING = { answerMs: 5_000, availabilityMs: 60_000 };

/**
 * Dashboard refresh cadence. It polls fast only while a visit can still be answered. Otherwise a
 * push wakes the panel right away, and the slower checks remain a backup: if notifications fail
 * silently on this browser, a new ring still shows up within a minute, well inside the visitor's
 * two-minute wait.
 */
export const DASHBOARD_POLLING = { answeringMs: 5_000, idleMs: 30_000, idleWithPushMs: 60_000 };
