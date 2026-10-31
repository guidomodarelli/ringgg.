import { createRoot } from 'react-dom/client';
import { Visitor } from '../../src/components/visitor';
import { VisitHistory } from '../../src/components/dashboard/visit-history';
import type { PublicHome, Visit } from '../../src/types/doorbell';

/** The visitor's page with the chat on, or the residents' history opened from a notification of `focusVisitId`. */
type ChatFixture =
  | { page: 'visitor'; home: PublicHome; token: string }
  | { page: 'resident'; visits: Visit[]; homeName: string; focusVisitId: string };

const fixture = (window as unknown as { __CHAT_FIXTURE__: ChatFixture }).__CHAT_FIXTURE__;
const root = createRoot(document.getElementById('root')!);
if (fixture.page === 'visitor') root.render(<Visitor home={fixture.home} token={fixture.token} chat />);
else root.render(<VisitHistory visits={fixture.visits} rejectedRings={[]} now={Date.now()} url="/t/token" pending="" run={async () => false} focusVisitId={fixture.focusVisitId} chatEnabled homeName={fixture.homeName} />);
