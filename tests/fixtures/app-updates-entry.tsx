import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useAppUpdates } from '../../src/components/use-app-updates';
import { api } from '../../src/lib/api';
import { RELOADS_STARTED_STORAGE_KEY } from './app-updates-contract';

/** Where the fixture server puts the deployment that served this page, as a build inlines its own. */
const root = document.getElementById('root')!;
const loadedVersion = root.dataset.appVersion ?? '';

/** The part of the Navigation API (not in TypeScript's DOM types yet) that tells a reload apart. */
interface NavigationEvent extends Event { navigationType: string }

// The Navigation API announces a reload synchronously, inside `location.reload()`, so the spec can
// tell that one started even before its request reaches the server.
(window as unknown as { navigation: EventTarget }).navigation.addEventListener('navigate', (event) => {
  if ((event as NavigationEvent).navigationType !== 'reload') return;
  const reloadsStarted = Number(sessionStorage.getItem(RELOADS_STARTED_STORAGE_KEY) ?? 0);
  sessionStorage.setItem(RELOADS_STARTED_STORAGE_KEY, String(reloadsStarted + 1));
});

/**
 * A page that keeps the app busy on demand, like an action running in the panel, and that saves a
 * change on its own, like the forms that keep their own pending state. Once the change is saved it
 * opens another page, as creating a home does.
 */
function AppUpdatesFixture() {
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  useAppUpdates({ busy, loadedVersion });
  async function save() {
    setSaving(true);
    try {
      const { next } = await api<{ next: string }>('slow-save', { change: 'name' });
      // Like a router push: the next page is read first, and only then does the address change.
      await fetch(next, { headers: { RSC: '1' } });
      window.history.pushState(null, '', next);
    } finally { setSaving(false); }
  }
  let status = 'Sin acciones';
  if (busy) status = 'Acción en curso';
  else if (saving) status = 'Guardando cambio';
  return <main>
    <p role="status">{status}</p>
    <button type="button" onClick={() => setBusy((current) => !current)}>{busy ? 'Terminar acción' : 'Empezar acción'}</button>
    <button type="button" disabled={saving} onClick={() => { void save(); }}>Guardar cambio</button>
  </main>;
}

createRoot(root).render(<AppUpdatesFixture />);
