'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { LoginShell } from './login-shell';
import { createSelfAuthClient } from '@/lib/self-auth-client';

/** Google One Tap is offered on entry, with an explicit button when the prompt is unavailable. */
export function GoogleLogin({ clientId, configured, signedIn = false, initialMessage = '' }: { clientId: string; configured: boolean; signedIn?: boolean; initialMessage?: string }) {
  const router = useRouter();
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
  async function signOut() {
    const result = await client.signOut();
    if (!result.error) { router.replace('/'); router.refresh(); }
    return result;
  }
  return <LoginShell><div className="login-form"><div className="soft-icon"><LockKeyhole /></div><h2>{signedIn ? 'Tu cuenta, tu casa' : 'Bienvenido a casa'}</h2><p>{signedIn ? 'Tu cuenta necesita acceso a esta vivienda.' : 'Ingresá con tu cuenta de Google para administrar tu timbre.'}</p>
    {!configured && <p className="feedback error" role="status">El acceso no está disponible en este momento. Intentá más tarde.</p>}
    {!signedIn && <button type="button" className="button primary" disabled={pending || !configured} onClick={() => { void run(() => client.signIn.social({ provider: 'google', callbackURL: '/' })); }}>Continuar con Google <ArrowRight size={18} /></button>}
    {signedIn && <button type="button" className="button outline" disabled={pending} onClick={() => { void run(signOut); }}>Cerrar sesión</button>}
    {error && <p className="feedback error" role="alert">{error}</p>}<small>Para acceder a una vivienda, tu correo debe estar autorizado.</small></div></LoginShell>;
}
