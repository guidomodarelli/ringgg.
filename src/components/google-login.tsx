'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { Brand } from './brand';
import { createSelfAuthClient } from '@/lib/self-auth-client';

/** Google One Tap is offered on entry, with an explicit button when the prompt is unavailable. */
export function GoogleLogin({ clientId, configured, signedIn = false, initialMessage = '' }: { clientId: string; configured: boolean; signedIn?: boolean; initialMessage?: string }) {
  const client = useMemo(() => createSelfAuthClient(clientId), [clientId]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(initialMessage);
  const lock = useRef(false);
  const promptStarted = useRef(false);
  useEffect(() => {
    if (configured && !signedIn && !promptStarted.current) {
      promptStarted.current = true;
      void client.oneTap({ callbackURL: '/', onPromptNotification: () => {} }).catch((error: unknown) => {
        console.warn('GoogleLogin: One Tap no disponible; se conserva el botón de ingreso.', { errorType: error instanceof Error ? error.name : 'UnknownError' });
      });
    }
  }, [client, configured, signedIn]);
  async function run(work: () => Promise<{ error?: unknown }>) {
    if (lock.current) return;
    lock.current = true; setPending(true); setError('');
    try { const result = await work(); if (result.error) setError('No pudimos iniciar sesión. Revisá tus datos e intentá de nuevo.'); }
    catch { setError('No pudimos conectar. Revisá tu conexión e intentá de nuevo.'); }
    finally { lock.current = false; setPending(false); }
  }
  return <main className="login-page"><Brand /><div className="login-layout"><section><span className="eyebrow">TU CASA, A UN TOQUE</span><h1>El timbre.<br />Ahora, con vos.</h1><p>Alguien llega. Tu celular te avisa.<br />Así de simple.</p><div className="bell-orbit"><div className="bell-shape"><span /><i /></div><span className="orbit-spark">✳</span></div></section><div className="login-form"><div className="soft-icon"><LockKeyhole /></div><h2>{signedIn ? 'Tu cuenta, tu casa' : 'Bienvenido a casa'}</h2><p>{signedIn ? 'Tu cuenta necesita acceso a esta vivienda.' : 'Ingresá con tu cuenta de Google para administrar tu timbre.'}</p>
    {!configured && <p className="feedback error" role="status">El acceso no está disponible en este momento. Intentá más tarde.</p>}
    {!signedIn && <button type="button" className="button primary" disabled={pending || !configured} onClick={() => { void run(() => client.signIn.social({ provider: 'google', callbackURL: '/' })); }}>Continuar con Google <ArrowRight size={18} /></button>}
    {signedIn && <button type="button" className="button outline" disabled={pending} onClick={() => { void run(async () => { const result = await client.signOut(); if (!result.error) window.location.assign('/'); return result; }); }}>Cerrar sesión</button>}
    {error && <p className="feedback error" role="alert">{error}</p>}<small>Para acceder a una vivienda, tu correo debe estar autorizado.</small></div></div><footer>Sin cables. Sin instalaciones. Más cerca.</footer></main>;
}
