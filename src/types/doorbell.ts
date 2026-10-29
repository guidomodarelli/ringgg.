export type DeliveryStatus = 'registered' | 'sent' | 'partial' | 'unavailable';
export interface Home { id: number; name: string; token: string; enabled: boolean }
export interface Visit { id: string; message: string; created_at: string; answered_at: string | null; delivery: DeliveryStatus }
export interface Device { id: string; name: string; created_at: string }
export interface DashboardData { home: Home; visits: Visit[]; devices: Device[]; pushReady: boolean; origin: string }
export interface PublicVisit { id: string; created_at: string; answered_at: string | null; delivery: DeliveryStatus }
