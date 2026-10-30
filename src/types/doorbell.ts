import type { VisitReply } from '@/constants/doorbell';
import type { HomeSummary, ResidentEntry } from './residents';

export type DeliveryStatus = 'registered' | 'sent' | 'partial' | 'unavailable';
/** `enabled = false` pauses the bell until someone resumes it; `paused_until` pauses it until that moment. */
export interface Home { id: number; name: string; token: string; enabled: boolean; paused_until: string | null; quiet_start: string | null; quiet_end: string | null }
/** Home as shown to residents: `paused` and `quiet` are derived on the server when it is read. */
export interface HomeState extends Home { paused: boolean; quiet: boolean }
/** `receipts` counts the devices whose service worker confirmed it received the ring. */
export interface Visit { id: string; message: string; created_at: string; answered_at: string | null; delivery: DeliveryStatus; reply: VisitReply | null; answered_by: string | null; note: string | null; noted_at: string | null; receipts: number }
/**
 * A device as one home sees it: the name this home gave it, its owner as the home calls them, and the
 * delivery health of the browser subscription (shared by every home it rings for).
 */
export interface Device { id: string; name: string; created_at: string; owner: string | null; last_success_at: string | null; last_failure_at: string | null; last_failure_status: number | null; last_received_at: string | null }
export interface DashboardSnapshot { home: HomeState; visits: Visit[]; devices: Device[] }
/**
 * The signed-in resident: `name` is how this home calls them (`null` until they choose it), and
 * `suggestedName` prefills that choice from their other homes or their account.
 */
export interface Viewer { name: string | null; suggestedName: string; email: string }
export interface DashboardData extends DashboardSnapshot { pushReady: boolean; origin: string; viewer: Viewer; homes: HomeSummary[]; residents: ResidentEntry[]; focusVisitId?: string }
/** A visitor's ring: `id` makes retries idempotent and `client` is the salted key its rate limits count. */
export interface RingRequest { id: string; message: string; client: string }
/** Visitor-facing visit: never includes the message, the note, or who answered. */
export interface PublicVisit { id: string; created_at: string; answered_at: string | null; delivery: DeliveryStatus; reply: VisitReply | null; noted: boolean }
/** `pausedUntil` is only set for a pause that ends on its own. */
export interface PublicHome { name: string; paused: boolean; pausedUntil: string | null; quiet: boolean; quietUntil: string | null }
