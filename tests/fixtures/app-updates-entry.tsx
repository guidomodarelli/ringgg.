import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useAppUpdates } from '../../src/components/use-app-updates';

/** A page that keeps the app busy on demand, like an action running in the panel. */
function AppUpdatesFixture() {
  const [busy, setBusy] = useState(false);
  useAppUpdates(busy);
  return <main>
    <p role="status">{busy ? 'Acción en curso' : 'Sin acciones'}</p>
    <button type="button" onClick={() => setBusy((current) => !current)}>{busy ? 'Terminar acción' : 'Empezar acción'}</button>
  </main>;
}

createRoot(document.getElementById('root')!).render(<AppUpdatesFixture />);
