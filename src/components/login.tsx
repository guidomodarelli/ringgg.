'use client';
import { useState } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { api } from '@/lib/api';
import { Brand } from './brand';
export function Login() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return <main className="login-page"><Brand /><div className="login-layout"><section><span className="eyebrow">TU CASA, A UN TOQUE</span><h1>El timbre.<br />Ahora, con vos.</h1><p>Alguien llega. Tu celular te avisa.<br />Así de simple.</p><div className="bell-orbit"><div className="bell-shape"><span /><i /></div><span className="orbit-spark">✳</span></div></section><form className="login-form" onSubmit={async (event) => {
    event.preventDefault(); if (pending) return; setPending(true); setError('');
    try { const form = new FormData(event.currentTarget); await api('login', { password: form.get('password') }); window.location.assign('/'); }
    catch (error) { setError(error instanceof Error ? error.message : 'No pudimos ingresar. Reintentá.'); setPending(false); }
  }}><div className="soft-icon"><LockKeyhole /></div><h2>Bienvenido a casa</h2><p>Ingresá con tu clave para administrar tu timbre.</p><label htmlFor="password">Clave de residente</label><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={256} onChange={() => setError('')} /><button className="button primary" disabled={pending}>{pending ? 'Ingresando…' : 'Entrar a mi casa'}<ArrowRight size={18} /></button><p className="feedback error" role="alert">{error}</p><small>La clave de desarrollo aparece en la terminal.<br />En producción, usá la clave configurada para tu casa.</small></form></div><footer>Sin cables. Sin instalaciones. Más cerca.</footer></main>;
}
