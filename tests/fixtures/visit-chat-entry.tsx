import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Visitor } from '../../src/components/visitor';
import { VisitHistory } from '../../src/components/dashboard/visit-history';
import type { PublicHome, Visit } from '../../src/types/doorbell';

/** The visitor's page with the chat on, or the residents' history opened from a notification of `focusVisitId`. */
type ChatFixture =
  | { page: 'visitor'; home: PublicHome; token: string }
  | { page: 'resident'; visits: Visit[]; homeName: string; focusVisitId: string };

/** The history as the dashboard holds it: «Ir al resumen» hides it like another section does, without unmounting it. */
function ResidentPanel({ visits, homeName, focusVisitId, now }: { visits: Visit[]; homeName: string; focusVisitId: string; now: number }) {
  const [onScreen, setOnScreen] = useState(true);
  return <>
    <button type="button" onClick={() => setOnScreen((current) => !current)}>{onScreen ? 'Ir al resumen' : 'Volver a Timbrazos'}</button>
    <div hidden={!onScreen}>
      <VisitHistory visits={visits} rejectedRings={[]} now={now} url="/t/token" pending="" run={async () => false} focusVisitId={focusVisitId} chatEnabled homeName={homeName} onScreen={onScreen} />
    </div>
  </>;
}

const fixture = (window as unknown as { __CHAT_FIXTURE__: ChatFixture }).__CHAT_FIXTURE__;
const root = createRoot(document.getElementById('root')!);
if (fixture.page === 'visitor') root.render(<Visitor home={fixture.home} token={fixture.token} chat />);
else root.render(<ResidentPanel visits={fixture.visits} homeName={fixture.homeName} focusVisitId={fixture.focusVisitId} now={Date.now()} />);
