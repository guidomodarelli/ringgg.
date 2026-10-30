import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsSection } from '../../src/components/dashboard/settings-section';
import type { RunAction } from '../../src/components/dashboard/types';
import type { HomeState } from '../../src/types/doorbell';

function Fixture() {
  const [home, setHome] = useState<HomeState>({ id: 1, name: 'Casa', token: 't', enabled: true, quiet_start: null, quiet_end: null, quiet: false });
  const [pending, setPending] = useState('');
  const run: RunAction = async (key, work) => {
    setPending(key);
    try { setHome(await work() as HomeState); return true; } catch { return false; } finally { setPending(''); }
  };
  return <main style={{ padding: '0 6%' }}><SettingsSection home={home} pending={pending} run={run} /></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
