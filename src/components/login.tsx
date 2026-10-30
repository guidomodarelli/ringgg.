'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { AUTH, AUTH_ERRORS, UNVERIFIED_EMAIL_CODES, type AuthFormMode } from '@/constants/auth';
import { HTTP } from '@/constants/doorbell';
import { LoginShell } from './login-shell';

const DEFAULT_HINT = 'Ingresá con tu cuenta para administrar tu timbre.';

/** Title, submit button and hint of each form mode. */
const MODE_COPY: Record<AuthFormMode, { title: string; action: string; hint: string }> = {
  'sign-in': { title: 'Bienvenido a casa', action: 'Entrar a mi casa', hint: DEFAULT_HINT },
  'sign-up': { title: 'Creá tu cuenta', action: 'Crear cuenta', hint: DEFAULT_HINT },
  verify: { title: 'Verificá tu correo', action: 'Verificar correo', hint: 'Ingresá el código que recibiste por correo.' },
  forgot: { title: 'Recuperá tu acceso', action: 'Enviar enlace', hint: DEFAULT_HINT },
  reset: { title: 'Una contraseña nueva', action: 'Guardar contraseña', hint: DEFAULT_HINT },
};
const SIGNED_IN_COPY = { title: 'Tu cuenta, tu casa', hint: 'Tu sesión está iniciada. El acceso requiere un correo verificado y autorizado.' };

/** Modes whose form asks for a password. */
const PASSWORD_MODES: ReadonlySet<AuthFormMode> = new Set<AuthFormMode>(['sign-in', 'sign-up', 'reset']);

/** Code and status of a failure the auth service answered; `null` when the request never got an answer. */
function authFailure(error: unknown): { code: string; status: number } | null {
  if (typeof error !== 'object' || error === null || !('code' in error) || typeof error.code !== 'string') return null;
  return { code: error.code, status: 'status' in error && typeof error.status === 'number' ? error.status : HTTP.internal };
}

/** A text field of the submitted form; a missing field reads as empty. */
function formText(fields: FormData, name: string) {
  const value = fields.get(name);
  return typeof value === 'string' ? value : '';
}

function PasswordField({ mode, pending, onChange }: { mode: AuthFormMode; pending: boolean; onChange: () => void }) {
  const signingIn = mode === 'sign-in';
  return <><label htmlFor="password">{mode === 'reset' ? 'Nueva contraseña' : 'Contraseña'}</label><input id="password" name="password" type="password" autoComplete={signingIn ? 'current-password' : 'new-password'} required minLength={signingIn ? undefined : AUTH.minimumPasswordLength} maxLength={AUTH.maximumPasswordLength} disabled={pending} onChange={onChange} /></>;
}

/** The inputs each mode asks for. */
function AuthFields({ mode, email, pending, onEmailChange, onPasswordChange }: { mode: AuthFormMode; email: string; pending: boolean; onEmailChange: (email: string) => void; onPasswordChange: () => void }) {
  return <>
    {mode === 'sign-up' && <><label htmlFor="resident-name">Tu nombre</label><input id="resident-name" name="name" autoComplete="name" required maxLength={50} disabled={pending} /></>}
    {mode !== 'reset' && <><label htmlFor="email">Correo electrónico</label><input id="email" name="email" type="email" autoComplete="email" required value={email} maxLength={254} disabled={pending} onChange={(event) => onEmailChange(event.target.value)} /></>}
    {PASSWORD_MODES.has(mode) && <PasswordField mode={mode} pending={pending} onChange={onPasswordChange} />}
    {mode === 'verify' && <><label htmlFor="otp">Código de verificación</label><input id="otp" name="otp" inputMode="numeric" autoComplete="one-time-code" required minLength={AUTH.verificationCodeLength} maxLength={AUTH.verificationCodeLength} disabled={pending} /></>}
  </>;
}

interface AuthOptionsProps { mode: AuthFormMode; pending: boolean; canResendCode: boolean; onModeChange: (mode: AuthFormMode) => void; onResendCode: () => void }

/** Ways to switch between creating an account, recovering it and verifying the email. */
function AuthOptions({ mode, pending, canResendCode, onModeChange, onResendCode }: AuthOptionsProps) {
  return <>
    {mode === 'sign-in' && <><button className="text-button" type="button" disabled={pending} onClick={() => onModeChange('sign-up')}>Crear una cuenta</button><button className="text-button" type="button" disabled={pending} onClick={() => onModeChange('forgot')}>Olvidé mi contraseña</button><button className="text-button" type="button" disabled={pending} onClick={() => onModeChange('verify')}>Verificar mi correo</button></>}
    {mode === 'verify' && <button className="text-button" type="button" disabled={pending || !canResendCode} onClick={onResendCode}>Pedir código nuevo</button>}
    {mode !== 'sign-in' && <button className="text-button" type="button" disabled={pending} onClick={() => onModeChange('sign-in')}>Volver a ingresar</button>}
  </>;
}

/** Every account action waits for managed Neon confirmation. There is no local session fallback. */
export function Login({ configured = false, initialMessage = '', signedIn = false, resetToken = '', initialEmail = '', initialMode }: { configured?: boolean; initialMessage?: string; signedIn?: boolean; resetToken?: string; initialEmail?: string; initialMode?: AuthFormMode }) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthFormMode>(initialMode || (resetToken ? 'reset' : 'sign-in'));
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(initialMessage);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  function changeMode(next: AuthFormMode) { setMode(next); setError(''); setMessage(''); }
  function finish(next: AuthFormMode, confirmation: string) { setMode(next); setMessage(confirmation); }
  function goHome() { router.replace('/'); router.refresh(); }
  async function action(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setPending(true); setError(''); setMessage('');
    try { await work(); }
    catch (authError) {
      // Neon's client throws an `AuthApiError` for 4xx answers instead of returning `{ error }`: same handling.
      const failure = authFailure(authError);
      if (failure && failure.status < HTTP.internal) showError({ error: { code: failure.code } });
      else setError(failure ? 'El servicio de acceso no respondió. Intentá de nuevo en un momento.' : 'No pudimos conectar con el servicio de acceso. Revisá tu conexión y volvé a intentar.');
    }
    finally { lock.current = false; setPending(false); }
  }
  function showError(result: { error?: { code?: string; message?: string } | null }) {
    if (!result.error) return false;
    setError(AUTH_ERRORS[result.error.code || ''] || 'No pudimos completar la operación. Revisá los datos e intentá de nuevo.');
    if (result.error.code && UNVERIFIED_EMAIL_CODES.has(result.error.code)) setMode('verify');
    return true;
  }
  const submitters: Record<AuthFormMode, (fields: FormData) => Promise<void>> = {
    'sign-in': async (fields) => { if (!showError(await authClient.signIn.email({ email: email.trim(), password: formText(fields, 'password') }))) goHome(); },
    'sign-up': async (fields) => {
      const result = await authClient.signUp.email({ email: email.trim(), password: formText(fields, 'password'), name: formText(fields, 'name').trim() });
      if (showError(result)) return;
      if (result.data?.user && !result.data.user.emailVerified) finish('verify', 'Cuenta creada. Verificá tu correo; podés pedir un código nuevo abajo.');
      else finish('sign-in', 'Cuenta creada. Ya podés ingresar.');
    },
    verify: async (fields) => { if (!showError(await authClient.emailOtp.verifyEmail({ email: email.trim(), otp: formText(fields, 'otp') }))) finish('sign-in', 'Correo verificado. Ingresá con tu contraseña.'); },
    forgot: async () => { if (!showError(await authClient.requestPasswordReset({ email: email.trim(), redirectTo: `${window.location.origin}/reset-password` }))) setMessage('Si existe una cuenta con ese correo, recibirás un enlace para cambiar la contraseña.'); },
    reset: async (fields) => {
      if (showError(await authClient.resetPassword({ newPassword: formText(fields, 'password'), token: resetToken }))) return;
      window.history.replaceState({}, '', '/');
      finish('sign-in', 'Contraseña actualizada. Ya podés ingresar.');
    },
  };
  async function submit(form: HTMLFormElement) {
    const fields = new FormData(form);
    await action(() => submitters[mode](fields));
  }
  const copy = signedIn ? SIGNED_IN_COPY : MODE_COPY[mode];
  return <LoginShell>
    <form className="login-form" key={mode} onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }}>
      <div className="soft-icon"><LockKeyhole /></div><h2>{copy.title}</h2><p>{copy.hint}</p>
      {!configured && <p className="feedback error" role="status">El acceso no está disponible en este momento. Intentá más tarde.</p>}
      {!signedIn && <>
        <AuthFields mode={mode} email={email} pending={pending} onEmailChange={(value) => { setEmail(value); setError(''); }} onPasswordChange={() => setError('')} />
        <button className="button primary" disabled={pending || !configured}>{pending ? 'Procesando…' : MODE_COPY[mode].action}<ArrowRight size={18} /></button>
      </>}
      <p className="feedback error" role="alert">{error}</p><p className="feedback success" role="status">{message}</p>
      <div className="auth-options">
        {signedIn
          ? <><button className="text-button" type="button" disabled={pending} onClick={() => action(async () => { if (!showError(await authClient.signOut())) goHome(); })}>Cerrar sesión</button><button className="text-button" type="button" disabled={pending} onClick={() => window.location.reload()}>Volver a comprobar acceso</button></>
          : <AuthOptions mode={mode} pending={pending} canResendCode={Boolean(email.trim()) && configured} onModeChange={changeMode} onResendCode={() => action(async () => { if (!showError(await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: 'email-verification' }))) setMessage('Solicitamos un código nuevo. Revisá tu correo y la carpeta de spam.'); })} />}
      </div><small>Para acceder a una vivienda, tu correo debe estar autorizado.</small>
    </form>
  </LoginShell>;
}
