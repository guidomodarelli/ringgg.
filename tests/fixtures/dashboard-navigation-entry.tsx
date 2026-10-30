import { createRoot } from 'react-dom/client';
import { DashboardNavigation } from '../../src/components/dashboard-navigation';

createRoot(document.getElementById('root')!).render(<DashboardNavigation initialView="overview" homeId={1} />);
