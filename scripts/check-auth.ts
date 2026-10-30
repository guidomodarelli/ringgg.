import { z } from 'zod';
import { AUTH } from '../src/constants/auth';
import { terminal } from './utils/terminal';

/** Neon Auth publishes at least one public key to verify sessions. */
const jwksSchema = z.object({ keys: z.array(z.unknown()).min(1) });

/** `/api/auth/get-session` answers `null` without a session, a session with its `user`, or `{ data: null }`. */
const sessionResponseSchema = z.union([
  z.null(),
  z.object({ user: z.unknown().refine((user) => user != null) }),
  z.object({ data: z.null() }),
]);

const ui = terminal();
ui.line('Ringgg · Neon Auth');
try {
  ui.line('[1/3] Revisar configuración de Neon Auth');
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl || !cookieSecret || cookieSecret.length < AUTH.cookieSecretMinimumLength) throw new Error('AUTH_CONFIGURATION_MISSING');
  await ui.wait('[2/3] Consultar claves públicas del servicio administrado', async () => {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/.well-known/jwks.json`, { signal: AbortSignal.timeout(AUTH.requestTimeoutMs) });
    if (!response.ok) throw new Error('AUTH_JWKS_UNAVAILABLE');
    if (!jwksSchema.safeParse(await response.json()).success) throw new Error('AUTH_JWKS_INVALID');
  });
  await ui.wait('[3/3] Comprobar el proxy de sesiones de Ringgg', async () => {
    const origin = process.env.APP_URL || 'http://localhost:3000';
    const response = await fetch(`${origin.replace(/\/$/, '')}/api/auth/get-session`, { signal: AbortSignal.timeout(AUTH.requestTimeoutMs) });
    if (!response.ok) throw new Error('AUTH_PROXY_UNAVAILABLE');
    if (!sessionResponseSchema.safeParse(await response.json()).success) throw new Error('AUTH_PROXY_INVALID');
  });
  ui.success('+--------------------------------------------------+\n| Neon Auth responde y el proxy funciona.           |\n| Falta probar login con un residente verificado.  |\n+--------------------------------------------------+');
} catch {
  ui.error('ERROR · No pudimos verificar Neon Auth. Revisá neon login, neon deploy, las variables NEON_AUTH_* y que Ringgg esté iniciado. No se muestran credenciales.');
  process.exitCode = 1;
}
