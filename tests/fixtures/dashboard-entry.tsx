import { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from '../../src/components/dashboard';
const w = window as unknown as { __INITIAL__: never; __commits: number };
w.__commits = 0;
createRoot(document.getElementById('root')!).render(<Profiler id="dashboard" onRender={() => { w.__commits += 1; }}><Dashboard initial={w.__INITIAL__} /></Profiler>);
