import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NotificationOnboarding } from '../../src/components/notification-onboarding';

function Fixture() {
  const [open, setOpen] = useState(true);
  const [permission, setPermission] = useState('default');
  const [outcome, setOutcome] = useState('');
  return <>
    <button onClick={() => setOpen(true)}>Mostrar activación</button>
    <button onClick={() => { setPermission('denied'); setOpen(true); }}>Permiso bloqueado</button>
    <button onClick={() => { setPermission('granted'); setOpen(true); }}>Permiso concedido</button>
    {outcome && <p>{outcome}</p>}
    {open && <NotificationOnboarding permission={permission} homeName="Casa de prueba" residentName="Guido" otherDeviceNames={['Android de Ana']} pending={false} error=""
      onActivate={(name) => { setOutcome(`Activación solicitada: ${name}`); setOpen(false); }}
      onRefresh={() => setPermission('default')}
      onSkip={() => { setOutcome('Sigue sin avisos'); setOpen(false); }}
      onSignOut={() => { setOutcome('Sesión cerrada'); setOpen(false); }} />}
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
