'use client';
import { useRef, useState } from 'react';
import { Plus, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { RESIDENTS } from '@/constants/residents';
import type { ResidentEntry } from '@/types/residents';

/** Only server-confirmed grants are shown. Repeated additions/removals are idempotent. */
export function ResidentManagement({ initial }: { initial: ResidentEntry[] }) {
  const [residents, setResidents] = useState(initial);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  async function update(action?: 'add' | 'remove', target?: string) {
    if (lock.current) return;
    lock.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = await api<{ residents?: ResidentEntry[]; removedSelf?: boolean }>('residents', action ? { action, email: target } : undefined);
      if (result.removedSelf) { window.location.assign('/'); return; }
      if (!result.residents) throw new Error('No pudimos actualizar los residentes. Volvé a intentar.');
      setResidents(result.residents);
      if (action === 'add') { setEmail(''); setMessage('Correo autorizado. Esa persona debe crear su cuenta y verificar su correo para ingresar. No se envió un email.'); }
      if (action === 'remove') { setRemoving(''); setMessage('Acceso y dispositivos vinculados revocados.'); }
    } catch (error) { setError(error instanceof Error ? error.message : 'No pudimos actualizar los residentes. Reintentá.'); }
    finally { lock.current = false; setPending(false); }
  }
  return <section id="residents" className="section-block lower-section"><div className="section-title"><div><h2>Residentes de tu casa</h2><p>Autorizá quién puede administrar el timbre y recibir visitas.</p></div><Users size={23} /></div>
    <form onSubmit={(event) => { event.preventDefault(); void update('add', email.trim()); }}>
      <label htmlFor="resident-email">Correo del nuevo residente</label><div className="inline-form"><input id="resident-email" type="email" autoComplete="off" value={email} required maxLength={RESIDENTS.emailMaxLength} disabled={pending} placeholder="persona@ejemplo.com" onChange={(event) => { setEmail(event.target.value); setError(''); }} /><button className="button primary" disabled={pending || !email.trim()}><Plus size={16} />{pending ? 'Procesando…' : 'Autorizar correo'}</button></div>
      <p className="section-footnote">Cada residente necesita una cuenta y su correo verificado. Todos los residentes pueden autorizar más personas.</p>
    </form><div aria-live="polite">{message && <p className="feedback success">{message}</p>}{error && <p className="feedback error" role="alert">{error}</p>}</div>
    {residents.map((resident) => <div className="device-row resident-row" key={resident.email}><ShieldCheck size={21} /><div><strong>{resident.email}</strong><span>{resident.canRemove ? 'Residente autorizado · Requiere correo verificado' : 'Último residente · Acceso protegido'}</span></div>{resident.canRemove && (removing === resident.email ? <div className="resident-confirm"><p>¿Quitar el acceso y desconectar sus dispositivos?</p><button type="button" className="text-button danger" disabled={pending} onClick={() => update('remove', resident.email)}>Sí, quitar acceso</button><button type="button" className="text-button" disabled={pending} onClick={() => setRemoving('')}>Cancelar</button></div> : <button type="button" className="icon-button" aria-label={`Quitar acceso a ${resident.email}`} disabled={pending} onClick={() => { setRemoving(resident.email); setError(''); }}><Trash2 size={17} /></button>)}</div>)}
    <button type="button" className="text-button" disabled={pending} onClick={() => update()}><RefreshCw size={15} />Actualizar residentes</button>
  </section>;
}
