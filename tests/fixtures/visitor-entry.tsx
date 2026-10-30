import { createRoot } from 'react-dom/client';
import { Visitor } from '../../src/components/visitor';
import type { PublicHome } from '../../src/types/doorbell';

const props = (window as unknown as { __VISITOR__: { home: PublicHome; token: string } }).__VISITOR__;
createRoot(document.getElementById('root')!).render(<Visitor home={props.home} token={props.token} />);
