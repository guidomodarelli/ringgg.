import { createRoot } from 'react-dom/client';
import { ResidentManagement } from '../../src/components/resident-management';

createRoot(document.getElementById('root')!).render(<ResidentManagement initial={[{ email: 'owner@example.com', source: 'administrator', canRemove: false }]} />);
