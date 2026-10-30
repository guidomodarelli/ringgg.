import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VisitHistory } from '../../src/components/dashboard/visit-history';
import type { Visit } from '../../src/types/doorbell';
import { api } from '../../src/lib/api';

/** Mirrors the dashboard action runner: server-confirmed, then a fresh snapshot. */
function Fixture() {
  const [visits, setVisits] = useState<Visit[]>((window as unknown as { __VISITS__: Visit[] }).__VISITS__);
  const [pending, setPending] = useState('');
  const [feedback, setFeedback] = useState('');
  const lock = useRef(false);
  async function run(key: string, work: () => Promise<unknown>, success: string) {
    if (lock.current) return false;
    lock.current = true; setPending(key);
    try { await work(); setVisits((await api<{ visits: Visit[] }>('dashboard')).visits); setFeedback(success); return true; }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'Error'); return false; }
    finally { setPending(''); lock.current = false; }
  }
  return <><p role="status">{feedback}</p><VisitHistory visits={visits} now={Date.now()} url="/t/token" pending={pending} run={run} focusVisitId={visits[0]?.id ?? ''} /></>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
