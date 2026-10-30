import type { VisitReply } from '@/constants/doorbell';

export type DeliveryStatus = 'registered' | 'sent' | 'partial' | 'unavailable';
export interface Home { id: number; name: string; token: string; enabled: boolean; quiet_start: string | null; quiet_end: string | null }
/** Home as shown to residents: `quiet` is derived on the server from the configured quiet hours. */
export interface HomeState extends Home { quiet: boolean }
export interface Visit { id: string; message: string; created_at: string; answered_at: string | null; delivery: DeliveryStatus; reply: VisitReply | null; answered_by: string | null; note: string | null; noted_at: string | null }
export interface Device { id: string; name: string; created_at: string }
export interface DashboardSnapshot { home: HomeState; visits: Visit[]; devices: Device[] }
export interface DashboardData extends DashboardSnapshot { pushReady: boolean; origin: string; isAdmin: boolean; residents: import('./residents').ResidentEntry[]; focusVisitId?: string }
/** Visitor-facing visit: never includes the message, the note, or who answered. */
export interface PublicVisit { id: string; created_at: string; answered_at: string | null; delivery: DeliveryStatus; reply: VisitReply | null; noted: boolean }
export interface PublicHome { name: string; enabled: boolean; quiet: boolean; quietUntil: string | null }
