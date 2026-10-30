export type DashboardView = 'overview' | 'history' | 'qr' | 'devices' | 'settings' | 'residents';
export const DASHBOARD_VIEWS: readonly DashboardView[] = ['overview', 'history', 'qr', 'devices', 'settings', 'residents'];
export const DASHBOARD_VIEW_EVENT = 'ringgg:viewchange';
/** Path of the dashboard; each section is a `?view=` of it. */
export const DASHBOARD_PATH = '/';
