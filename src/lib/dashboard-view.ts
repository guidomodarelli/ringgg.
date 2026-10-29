import { DASHBOARD_VIEWS, DASHBOARD_VIEW_EVENT, type DashboardView } from '@/constants/dashboard-views';

/** Parse navigation state from a stable URL and keep older section links working. */
export function getDashboardView(search: string, hash = ''): DashboardView {
  const selected = new URLSearchParams(search).get('view') || hash.replace(/^#/, '');
  return DASHBOARD_VIEWS.includes(selected as DashboardView) ? selected as DashboardView : 'overview';
}

/** Update the visible section without reloading or making another data request. */
export function navigateDashboard(view: DashboardView) {
  window.history.pushState(null, '', view === 'overview' ? '/' : `/?view=${view}`);
  window.dispatchEvent(new Event(DASHBOARD_VIEW_EVENT));
  window.scrollTo(0, 0);
}
