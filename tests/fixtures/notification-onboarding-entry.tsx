import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NotificationOnboarding } from '../../src/components/notification-onboarding';

function Fixture() {
  const [open, setOpen] = useState(true);
  const [permission, setPermission] = useState('default');
  const [activated, setActivated] = useState(false);
  return <><button onClick={() => setOpen(true)}>Mostrar activación</button><button onClick={() => { setPermission('denied'); setOpen(true); }}>Permiso bloqueado</button>{activated && <p>Activación solicitada</p>}{open && <NotificationOnboarding permission={permission} pending={false} error="" onActivate={() => { setActivated(true); setOpen(false); }} onRefresh={() => setPermission('default')} onSignOut={() => setOpen(false)} />}</>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
