import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsSection } from '../../src/components/dashboard/settings-section';
import type { RunAction } from '../../src/components/dashboard/types';
import type { DashboardSnapshot, HomeState } from '../../src/types/doorbell';

/** Mirrors the dashboard runner for snapshot routes: the confirmed snapshot replaces the home. */
function Fixture() {
  const [home, setHome] = useState<HomeState>((window as unknown as { __HOME__: HomeState }).__HOME__);
  const [pending, setPending] = useState('');
  const [feedback, setFeedback] = useState('');
  const run: RunAction = async (key, work, success) => {
    setPending(key);
    try { const result = await work(); setHome((result as DashboardSnapshot).home); setFeedback(typeof success === 'function' ? success(result) : success); return true; }
    catch { return false; } finally { setPending(''); }
  };
  return <main style={{ padding: '0 6%' }}><p role="status">{feedback}</p><SettingsSection home={home} homes={1} residents={1} pending={pending} run={run} /></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
