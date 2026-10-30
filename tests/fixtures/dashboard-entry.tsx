import { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from '../../src/components/dashboard';
const fixtureWindow = window as unknown as { __INITIAL__: never; __commits: number };
fixtureWindow.__commits = 0;
createRoot(document.getElementById('root')!).render(<Profiler id="dashboard" onRender={() => { fixtureWindow.__commits += 1; }}><Dashboard initial={fixtureWindow.__INITIAL__} /></Profiler>);
