import { afterEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { HOMES } from '../src/constants/homes';
import { STARTUP_SCREENS } from '../src/constants/startup-images';
import { startupImageMedia, startupImages, startupImageSize } from '../src/lib/startup-images';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('arranque de la app instalada', () => {
  test('con la sesión propia, el proxy responde sin consultar la base y recuerda la casa', async () => {
    vi.stubEnv('AUTH_PROVIDER', 'self');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    vi.stubEnv('SELF_AUTH_SECRET', 'ringgg-proxy-test-secret-only-for-tests');
    // A database that never answers: a query from the proxy would hang the test past its timeout.
    vi.stubEnv('SELF_AUTH_DATABASE_URL', 'postgresql://ringgg:ringgg@10.255.255.1:5432/ringgg');
    vi.stubEnv('GOOGLE_CLIENT_ID', 'ringgg-test-client');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'ringgg-test-client-secret');
    const { default: proxy } = await import('../src/proxy');
    const request = new NextRequest(`http://localhost:3000/?${HOMES.queryParameter}=3`, { headers: { cookie: 'better-auth.session_token=abc.def' } });
    const response = await proxy(request);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.getSetCookie()).toEqual([expect.stringMatching(new RegExp(`^${HOMES.cookieName}=3;`))]);
  }, 5_000);

  test('cada pantalla de iPhone tiene su imagen de inicio con el tamaño exacto en píxeles', () => {
    const images = startupImages();
    expect(images).toHaveLength(STARTUP_SCREENS.length);
    expect(new Set(images.map((image) => image.url)).size).toBe(images.length);
    expect(new Set(images.map((image) => image.media)).size).toBe(images.length);
    const sixteenPro = { width: 402, height: 874, ratio: 3 } as const;
    expect(STARTUP_SCREENS).toContainEqual(sixteenPro);
    expect(startupImageSize(sixteenPro)).toBe('1206x2622');
    expect(startupImageMedia(sixteenPro)).toBe('(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)');
  });
});
