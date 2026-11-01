import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => { vi.doUnmock('../src/server/auth'); vi.doUnmock('../src/server/database'); vi.doUnmock('next/navigation'); vi.resetModules(); });

test('si la base falla mientras se espera la identidad, el error llega a la página sin quedar como rechazo no manejado', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  let resolveIdentity: (user: null | { id: string }) => void = () => undefined;
  const failure = new Error('Neon no responde');
  vi.doMock('../src/server/database', () => ({ getDatabase: () => Promise.reject(failure) }));
  vi.doMock('../src/server/auth', () => ({ getIdentity: () => new Promise((resolve) => { resolveIdentity = resolve; }) }));
  vi.doMock('next/navigation', () => ({ redirect: () => { throw new Error('NEXT_REDIRECT'); } }));
  try {
    const { identityWithDatabase } = await import('../src/server/page-session');
    const page = identityWithDatabase();
    // Long enough for Node to report a rejection nobody handles.
    await new Promise((resolve) => setTimeout(resolve, 20));
    resolveIdentity({ id: 'residente' });
    await expect(page).rejects.toBe(failure);
    expect(unhandled).toEqual([]);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
