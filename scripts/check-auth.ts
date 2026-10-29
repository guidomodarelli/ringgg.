import { AUTH } from '../src/constants/auth';
import { terminal } from './utils/terminal';

const ui = terminal();
ui.line('Ringgg · Neon Auth');
try {
  ui.line('[1/3] Revisar configuración de Neon Auth');
  if (!process.env.NEON_AUTH_BASE_URL || !process.env.NEON_AUTH_COOKIE_SECRET || process.env.NEON_AUTH_COOKIE_SECRET.length < AUTH.cookieSecretMinimumLength) throw new Error('AUTH_CONFIGURATION_MISSING');
  await ui.wait('[2/3] Consultar claves públicas del servicio administrado', async () => {
    const response = await fetch(`${process.env.NEON_AUTH_BASE_URL!.replace(/\/$/, '')}/.well-known/jwks.json`, { signal: AbortSignal.timeout(AUTH.requestTimeoutMs) });
    if (!response.ok) throw new Error('AUTH_JWKS_UNAVAILABLE');
    const data = await response.json();
    if (!Array.isArray(data.keys) || data.keys.length === 0) throw new Error('AUTH_JWKS_INVALID');
  });
  await ui.wait('[3/3] Comprobar el proxy de sesiones de Ringgg', async () => {
    const origin = process.env.APP_URL || 'http://localhost:3000';
    const response = await fetch(`${origin.replace(/\/$/, '')}/api/auth/get-session`, { signal: AbortSignal.timeout(AUTH.requestTimeoutMs) });
    if (!response.ok) throw new Error('AUTH_PROXY_UNAVAILABLE');
    const session = await response.json();
    if (session !== null && session?.user == null && session?.data !== null) throw new Error('AUTH_PROXY_INVALID');
  });
  ui.success('+--------------------------------------------------+\n| Neon Auth responde y el proxy funciona.           |\n| Falta probar login con un residente verificado.  |\n+--------------------------------------------------+');
} catch {
  ui.error('ERROR · No pudimos verificar Neon Auth. Revisá neon login, neon deploy, las variables NEON_AUTH_* y que Ringgg esté iniciado. No se muestran credenciales.');
  process.exitCode = 1;
}
