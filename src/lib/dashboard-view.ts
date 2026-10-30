import { DASHBOARD_PATH, DASHBOARD_VIEWS, DASHBOARD_VIEW_EVENT, type DashboardView } from '@/constants/dashboard-views';
import { HOMES } from '@/constants/homes';

/** Parse navigation state from a stable URL and keep older section links working. */
export function getDashboardView(search: string, hash = ''): DashboardView {
  const selected = new URLSearchParams(search).get('view') || hash.replace(/^#/, '');
  return DASHBOARD_VIEWS.includes(selected as DashboardView) ? selected as DashboardView : 'overview';
}

/**
 * Stable address of a section of one home: the overview is the dashboard root. The home stays in the
 * URL, so a reload or a second tab opens the same home.
 */
export function dashboardHref(view: DashboardView, homeId: number) {
  const home = `${HOMES.queryParameter}=${homeId}`;
  return view === 'overview' ? `${DASHBOARD_PATH}?${home}` : `${DASHBOARD_PATH}?${home}&view=${view}`;
}

/** Update the visible section without reloading or making another data request. */
export function navigateDashboard(view: DashboardView, homeId: number) {
  window.history.pushState(null, '', dashboardHref(view, homeId));
  window.dispatchEvent(new Event(DASHBOARD_VIEW_EVENT));
  window.scrollTo(0, 0);
}
