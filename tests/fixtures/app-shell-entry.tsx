import { createRoot } from 'react-dom/client';
import { Dashboard } from '../../src/components/dashboard';
import { DashboardSidebar } from '../../src/components/dashboard-sidebar';
import type { DashboardData } from '../../src/types/doorbell';

const initial = (window as unknown as { __INITIAL__: DashboardData }).__INITIAL__;
// The same shell the panel page renders: the side bar next to the workspace.
createRoot(document.getElementById('root')!).render(<div className="app-shell">
  <a className="skip-link" href="#main">Ir al contenido</a>
  <DashboardSidebar homeId={initial.home.id} homeName={initial.home.name} viewer={initial.viewer} initialView="overview" />
  <div className="workspace"><Dashboard initial={initial} /></div>
</div>);
