import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VisitHistory } from '../../src/components/dashboard/visit-history';
import type { Visit } from '../../src/types/doorbell';
import { api } from '../../src/lib/api';

/** The history renders with the clock of the page load, like the dashboard's clock before its next tick. */
const loadedAt = Date.now();

/** Mirrors the dashboard action runner: server-confirmed, then a fresh snapshot. */
function Fixture() {
  const [visits, setVisits] = useState<Visit[]>((window as unknown as { __VISITS__: Visit[] }).__VISITS__);
  const [pending, setPending] = useState('');
  const [feedback, setFeedback] = useState('');
  const lock = useRef(false);
  async function run(key: string, work: () => Promise<unknown>, success: string | ((result: unknown) => string)) {
    if (lock.current) return false;
    lock.current = true; setPending(key);
    try { const result = await work(); setVisits((await api<{ visits: Visit[] }>('dashboard')).visits); setFeedback(typeof success === 'function' ? success(result) : success); return true; }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'Error'); return false; }
    finally { setPending(''); lock.current = false; }
  }
  return <><p role="status">{feedback}</p><VisitHistory visits={visits} now={loadedAt} url="/t/token" pending={pending} run={run} focusVisitId={visits[0]?.id ?? ''} /></>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
