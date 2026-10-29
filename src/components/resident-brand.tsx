'use client';
import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { BrandContents } from './brand';
import { navigateDashboard } from '@/lib/dashboard-view';
import { api } from '@/lib/api';

/** The logo navigates immediately and sends one server-confirmed test to this resident's devices. */
export function ResidentBrand() {
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  async function handleClick() {
    navigateDashboard('overview');
    if (lock.current) return;
    lock.current = true; setPending(true); setMessage('Enviando la prueba…');
    try {
      const result = await api<{ accepted: number; total: number }>('test-my-devices', {});
      setMessage(result.accepted < result.total ? `Enviamos la prueba a ${result.accepted} de tus ${result.total} dispositivos. Revisá tu celular.` : 'Enviamos la prueba. Revisá tu celular.');
    } catch { setMessage('No pudimos confirmar la prueba. Revisá tu celular y tus dispositivos antes de intentar de nuevo.'); }
    finally { setPending(false); lock.current = false; }
  }
  return <><button type="button" className="brand" aria-label="Volver al resumen y enviar una notificación de prueba" aria-busy={pending} onClick={() => { void handleClick(); }}><BrandContents /></button>{message && <div className="brand-feedback" role="status" aria-live="polite"><span>{message}</span>{!pending && <button type="button" aria-label="Cerrar aviso" onClick={() => setMessage('')}><X size={16} /></button>}</div>}</>;
}
