import { createRoot } from 'react-dom/client';
import { Dashboard } from '../../src/components/dashboard';
import { DashboardSidebar } from '../../src/components/dashboard-sidebar';
import { getDashboardView } from '../../src/lib/dashboard-view';
import type { DashboardData } from '../../src/types/doorbell';

/** The panel page as `src/app/page.tsx` renders it: the sidebar's navigation next to the dashboard, each a client leaf. */
const initial = (window as unknown as { __INITIAL__: DashboardData }).__INITIAL__;
const initialView = getDashboardView(window.location.search);
createRoot(document.getElementById('root')!).render(<div className="app-shell">
  <a className="skip-link" href="#main">Ir al contenido</a>
  <DashboardSidebar homeId={initial.home.id} homeName={initial.home.name} viewer={initial.viewer} initialView={initialView} />
  <div className="workspace"><Dashboard key={initial.home.id} initialView={initialView} initial={initial} /></div>
</div>);
