import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DoorbellPauseControl } from '../../src/components/doorbell-pause-control';

function Fixture() {
  const [enabled, setEnabled] = useState(true);
  const [pending, setPending] = useState(false);
  async function save(value: boolean) {
    setPending(true);
    try { const result = await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: value }) }); if (!result.ok) return false; setEnabled(value); return true; }
    finally { setPending(false); }
  }
  return <DoorbellPauseControl enabled={enabled} pending={pending} onPause={() => save(false)} onResume={() => save(true)} />;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
