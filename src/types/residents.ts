import type { ResidentIdentity } from './auth';

/**
 * A resident of one home. `name` is how the residents of that home call them (required before using
 * the panel, unique in the home); `null` until they choose it. `environment` entries come from the
 * deployment configuration of the original home; `invitation` entries were added from the panel.
 */
export interface ResidentEntry { email: string; name: string | null; source: 'environment' | 'invitation'; canRemove: boolean }
/** Bootstrap emails from `RESIDENT_ADMIN_EMAILS` and `RESIDENT_EMAILS`; both grant the same shared access to the original home. */
export interface ResidentSettings { bootstrapEmails: string[] }
/** A verified identity with access to one home, and the name it uses there (`null` until chosen). */
export interface HomeMember extends ResidentIdentity { homeId: number; displayName: string | null }
/** A home in the resident's home switcher. */
export interface HomeSummary { id: number; name: string }
