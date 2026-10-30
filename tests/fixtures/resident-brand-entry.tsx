import { createRoot } from 'react-dom/client';
import { DashboardNavigation } from '../../src/components/dashboard-navigation';
import { ResidentBrand } from '../../src/components/resident-brand';

createRoot(document.getElementById('root')!).render(<><ResidentBrand homeId={1} /><DashboardNavigation initialView="settings" homeId={1} /><label htmlFor="marker">Dato sin guardar</label><input id="marker" /></>);
