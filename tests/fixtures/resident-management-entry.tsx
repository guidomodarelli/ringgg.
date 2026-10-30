import { createRoot } from 'react-dom/client';
import { ResidentManagement } from '../../src/components/resident-management';

createRoot(document.getElementById('root')!).render(<ResidentManagement homeId={1} initial={[{ email: 'owner@example.com', name: 'Guido', source: 'environment', canRemove: false }]} homeName="Casa de prueba" origin="https://ringgg.example" viewerEmail="owner@example.com" />);
