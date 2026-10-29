'use client';
import { useRef, useState } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { AUTH, AUTH_ERRORS, type AuthFormMode } from '@/constants/auth';
import { Brand } from './brand';

/** Every account action waits for managed Neon confirmation. There is no local session fallback. */
export function Login({ configured = false, initialMessage = '', signedIn = false, resetToken = '', initialEmail = '', initialMode }: { configured?: boolean; initialMessage?: string; signedIn?: boolean; resetToken?: string; initialEmail?: string; initialMode?: AuthFormMode }) {
  const [mode, setMode] = useState<AuthFormMode>(initialMode || (resetToken ? 'reset' : 'sign-in'));
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(initialMessage);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  function changeMode(next: AuthFormMode) { setMode(next); setError(''); setMessage(''); }
  async function action(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setPending(true); setError(''); setMessage('');
    try { await work(); }
    catch { setError('No pudimos conectar con el servicio de acceso. Revisá tu conexión y volvé a intentar.'); }
    finally { lock.current = false; setPending(false); }
  }
  function showError(result: { error?: { code?: string; message?: string } | null }) {
    if (!result.error) return false;
    setError(AUTH_ERRORS[result.error.code || ''] || 'No pudimos completar la operación. Revisá los datos e intentá de nuevo.');
    if (result.error.code === 'EMAIL_NOT_VERIFIED') setMode('verify');
    return true;
  }
  async function submit(form: HTMLFormElement) {
    const fields = new FormData(form);
    const password = String(fields.get('password') || '');
    await action(async () => {
      if (mode === 'sign-in') {
        const result = await authClient.signIn.email({ email: email.trim(), password });
        if (!showError(result)) window.location.assign('/');
      } else if (mode === 'sign-up') {
        const result = await authClient.signUp.email({ email: email.trim(), password, name: String(fields.get('name') || '').trim() });
        if (showError(result)) return;
        if (result.data?.user && !result.data.user.emailVerified) { setMode('verify'); setMessage('Cuenta creada. Verificá tu correo; podés pedir un código nuevo abajo.'); }
        else { setMode('sign-in'); setMessage('Cuenta creada. Ya podés ingresar.'); }
      } else if (mode === 'verify') {
        const result = await authClient.emailOtp.verifyEmail({ email: email.trim(), otp: String(fields.get('otp') || '') });
        if (!showError(result)) { setMode('sign-in'); setMessage('Correo verificado. Ingresá con tu contraseña.'); }
      } else if (mode === 'forgot') {
        const result = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: `${window.location.origin}/reset-password` });
        if (!showError(result)) setMessage('Si existe una cuenta con ese correo, recibirás un enlace para cambiar la contraseña.');
      } else {
        const result = await authClient.resetPassword({ newPassword: password, token: resetToken });
        if (!showError(result)) { window.history.replaceState({}, '', '/'); setMode('sign-in'); setMessage('Contraseña actualizada. Ya podés ingresar.'); }
      }
    });
  }
  const title = signedIn ? 'Tu cuenta, tu casa' : mode === 'sign-up' ? 'Creá tu cuenta' : mode === 'verify' ? 'Verificá tu correo' : mode === 'forgot' ? 'Recuperá tu acceso' : mode === 'reset' ? 'Una contraseña nueva' : 'Bienvenido a casa';
  const actionLabel = mode === 'sign-up' ? 'Crear cuenta' : mode === 'verify' ? 'Verificar correo' : mode === 'forgot' ? 'Enviar enlace' : mode === 'reset' ? 'Guardar contraseña' : 'Entrar a mi casa';
  return <main className="login-page"><Brand /><div className="login-layout"><section><span className="eyebrow">TU CASA, A UN TOQUE</span><h1>El timbre.<br />Ahora, con vos.</h1><p>Alguien llega. Tu celular te avisa.<br />Así de simple.</p><div className="bell-orbit"><div className="bell-shape"><span /><i /></div><span className="orbit-spark">✳</span></div></section>
    <form className="login-form" key={mode} onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }}>
      <div className="soft-icon"><LockKeyhole /></div><h2>{title}</h2><p>{signedIn ? 'Tu sesión está iniciada. El acceso requiere un correo verificado y autorizado.' : mode === 'verify' ? 'Ingresá el código que recibiste por correo.' : 'Ingresá con tu cuenta para administrar tu timbre.'}</p>
      {!configured && <p className="feedback error" role="status">Falta conectar Neon Auth. Completá el acceso del CLI y ejecutá neon init y neon deploy.</p>}
      {!signedIn && <>
        {mode === 'sign-up' && <><label htmlFor="resident-name">Tu nombre</label><input id="resident-name" name="name" autoComplete="name" required maxLength={50} disabled={pending} /></>}
        {mode !== 'reset' && <><label htmlFor="email">Correo electrónico</label><input id="email" name="email" type="email" autoComplete="email" required value={email} maxLength={254} disabled={pending} onChange={(event) => { setEmail(event.target.value); setError(''); }} /></>}
        {(mode === 'sign-in' || mode === 'sign-up' || mode === 'reset') && <><label htmlFor="password">{mode === 'reset' ? 'Nueva contraseña' : 'Contraseña'}</label><input id="password" name="password" type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} required minLength={mode === 'sign-in' ? undefined : AUTH.minimumPasswordLength} maxLength={AUTH.maximumPasswordLength} disabled={pending} onChange={() => setError('')} /></>}
        {mode === 'verify' && <><label htmlFor="otp">Código de verificación</label><input id="otp" name="otp" inputMode="numeric" autoComplete="one-time-code" required minLength={AUTH.verificationCodeLength} maxLength={AUTH.verificationCodeLength} disabled={pending} /></>}
        <button className="button primary" disabled={pending || !configured}>{pending ? 'Procesando…' : actionLabel}<ArrowRight size={18} /></button>
      </>}
      <p className="feedback error" role="alert">{error}</p><p className="feedback success" role="status">{message}</p>
      <div className="auth-options">
        {signedIn ? <><button className="text-button" type="button" disabled={pending} onClick={() => action(async () => { const result = await authClient.signOut(); if (!showError(result)) window.location.assign('/'); })}>Cerrar sesión</button><button className="text-button" type="button" disabled={pending} onClick={() => window.location.reload()}>Volver a comprobar acceso</button></> : <>
          {mode === 'sign-in' && <><button className="text-button" type="button" disabled={pending} onClick={() => changeMode('sign-up')}>Crear una cuenta</button><button className="text-button" type="button" disabled={pending} onClick={() => changeMode('forgot')}>Olvidé mi contraseña</button><button className="text-button" type="button" disabled={pending} onClick={() => changeMode('verify')}>Verificar mi correo</button></>}
          {mode === 'verify' && <button className="text-button" type="button" disabled={pending || !email.trim() || !configured} onClick={() => action(async () => { const result = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: 'email-verification' }); if (!showError(result)) setMessage('Solicitamos un código nuevo. Revisá tu correo y la carpeta de spam.'); })}>Pedir código nuevo</button>}
          {mode !== 'sign-in' && <button className="text-button" type="button" disabled={pending} onClick={() => changeMode('sign-in')}>Volver a ingresar</button>}
        </>}
      </div><small>Acceso con Neon Auth. Crear una cuenta no habilita una vivienda: el administrador debe autorizar tu correo.</small>
    </form></div><footer>Sin cables. Sin instalaciones. Más cerca.</footer></main>;
}
