export type DashboardView = 'overview' | 'history' | 'qr' | 'devices' | 'settings' | 'residents';
export const DASHBOARD_VIEWS: readonly DashboardView[] = ['overview', 'history', 'qr', 'devices', 'settings', 'residents'];
export const DASHBOARD_VIEW_EVENT = 'ringgg:viewchange';
/** Path of the dashboard; each section is a `?view=` of it. */
export const DASHBOARD_PATH = '/';
/** The section whose navigation link counts the visits that still wait for an answer. */
export const AWAITING_ANSWER_VIEW: DashboardView = 'history';
