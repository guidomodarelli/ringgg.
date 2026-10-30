'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, RefreshCw, Share2, ShieldCheck, Trash2, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { invitationMessage, shareInvitation } from '@/lib/invitation';
import { cleanName } from '@/lib/names';
import { RESIDENTS } from '@/constants/residents';
import { HOMES, RESIDENT_NAMES } from '@/constants/homes';
import type { ResidentEntry } from '@/types/residents';

interface ResidentManagementProps {
  homeId: number;
  initial: ResidentEntry[];
  homeName: string;
  origin: string;
  viewerEmail: string;
}

type ResidentChange = { action: 'add' | 'remove'; email: string } | { action: 'rename'; email: string; name: string };

/** What each confirmed change tells the resident. */
const CHANGE_MESSAGES = {
  add: 'Correo autorizado. Esa persona debe crear su cuenta y verificar su correo para ingresar. Compartile la invitación: Ringgg no envía emails.',
  remove: 'Acceso y dispositivos vinculados revocados.',
  rename: 'Nombre actualizado.',
} satisfies Record<ResidentChange['action'], string>;

/** Inline name editor: required, and a name another resident uses is rejected next to the field. */
function ResidentNameForm({ resident, pending, error, onSave, onCancel, onEdit }: { resident: ResidentEntry; pending: boolean; error: string; onSave: (name: string) => void; onCancel: () => void; onEdit: () => void }) {
  const [name, setName] = useState(resident.name ?? '');
  const inputId = `resident-name-${resident.email}`;
  return <form className="device-rename" onSubmit={(event) => { event.preventDefault(); if (cleanName(name)) onSave(cleanName(name)); }}>
    <label htmlFor={inputId}>Nombre de {resident.email}</label>
    <div className="inline-form">
      <input id={inputId} value={name} required maxLength={RESIDENT_NAMES.maxLength} disabled={pending} aria-invalid={error ? true : undefined} onChange={(event) => { setName(event.target.value); onEdit(); }} />
      <button className="button outline small" disabled={pending || !cleanName(name)}>{pending ? 'Guardando…' : 'Guardar'}</button>
      <button type="button" className="text-button" disabled={pending} onClick={onCancel}>Cancelar</button>
    </div>
    {error && <p className="field-error" role="alert">{error}</p>}
  </form>;
}

/** Only server-confirmed grants are shown. Repeated additions/removals are idempotent. */
export function ResidentManagement({ homeId, initial, homeName, origin, viewerEmail }: ResidentManagementProps) {
  const router = useRouter();
  const [residents, setResidents] = useState(initial);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState('');
  const [renaming, setRenaming] = useState('');
  const [renameError, setRenameError] = useState('');
  const [invited, setInvited] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const lock = useRef(false);

  /** Leaves the form that made a confirmed change and says what changed. */
  function applyConfirmed(change: ResidentChange) {
    setMessage(CHANGE_MESSAGES[change.action]);
    if (change.action === 'add') { setEmail(''); setInvited(change.email.toLowerCase()); }
    if (change.action === 'remove') { setRemoving(''); setInvited(''); }
    // The resident's own name also shows in the server-rendered sidebar.
    if (change.action === 'rename') { setRenaming(''); if (change.email === viewerEmail.toLowerCase()) router.refresh(); }
  }

  async function update(change?: ResidentChange) {
    if (lock.current) return;
    lock.current = true; setPending(true); setError(''); setRenameError(''); setMessage('');
    try {
      const result = await api<{ residents?: ResidentEntry[]; removedSelf?: boolean }>(change ? 'residents' : `residents?${HOMES.queryParameter}=${homeId}`, change ? { home: homeId, ...change } : undefined);
      // Leaving a home reopens the panel on another one, or the screen that explains there is none.
      if (result.removedSelf) { router.replace('/'); router.refresh(); return; }
      if (!result.residents) throw new Error('No pudimos actualizar los residentes. Volvé a intentar.');
      setResidents(result.residents);
      if (change) applyConfirmed(change);
    } catch (updateError) {
      const text = updateError instanceof Error ? updateError.message : 'No pudimos actualizar los residentes. Reintentá.';
      if (change?.action === 'rename') setRenameError(text); else setError(text);
    }
    finally { lock.current = false; setPending(false); }
  }

  async function share() {
    setError('');
    const outcome = await shareInvitation(invitationMessage(homeName, invited, origin));
    if (outcome === 'copied') setMessage('Invitación copiada. Pegala en el chat con esa persona.');
    if (outcome === 'failed') setError('No pudimos compartir la invitación. Copiá el enlace de ingreso y mandáselo a mano.');
  }

  return <section id="residents" className="section-block lower-section">
    <div className="section-title"><div><h2>Residentes de tu casa</h2><p>Autorizá quién puede administrar el timbre y recibir visitas.</p></div><Users size={23} /></div>
    <form onSubmit={(event) => { event.preventDefault(); void update({ action: 'add', email: email.trim() }); }}>
      <label htmlFor="resident-email">Correo del nuevo residente</label>
      <div className="inline-form">
        <input id="resident-email" type="email" autoComplete="off" value={email} required maxLength={RESIDENTS.emailMaxLength} disabled={pending} placeholder="persona@ejemplo.com" onChange={(event) => { setEmail(event.target.value); setError(''); }} />
        <button className="button primary" disabled={pending || !email.trim()}><Plus size={16} />{pending ? 'Procesando…' : 'Autorizar correo'}</button>
      </div>
      <p className="section-footnote">Cada residente necesita una cuenta y su correo verificado. Todos los residentes pueden autorizar más personas y cambiar los nombres.</p>
    </form>
    <div aria-live="polite">
      {message && <p className="feedback success">{message}</p>}
      {invited && <button type="button" className="button outline small resident-share" onClick={() => { void share(); }}><Share2 size={16} /> Compartir invitación</button>}
      {error && <p className="feedback error" role="alert">{error}</p>}
    </div>
    {residents.map((resident) => <div className="device-row resident-row" key={resident.email}>
      <ShieldCheck size={21} />
      {renaming === resident.email
        ? <ResidentNameForm resident={resident} pending={pending} error={renameError} onSave={(name) => { void update({ action: 'rename', email: resident.email, name }); }} onCancel={() => { setRenaming(''); setRenameError(''); }} onEdit={() => setRenameError('')} />
        : <div className="device-info">
          <strong>{resident.name ?? 'Todavía sin nombre'}{resident.email === viewerEmail.toLowerCase() && <span className="device-badge">Vos</span>}</strong>
          <span>{resident.email}</span>
          <span>{resident.canRemove ? 'Residente autorizado · Requiere correo verificado' : 'Último residente · Acceso protegido'}</span>
        </div>}
      {renaming !== resident.email && <div className="device-actions">
        <button type="button" className="text-button" disabled={pending} aria-label={`Editar el nombre de ${resident.email}`} onClick={() => { setRenaming(resident.email); setRemoving(''); setRenameError(''); }}><Pencil size={15} /> Editar nombre</button>
        {resident.canRemove && (removing === resident.email
          ? <div className="resident-confirm"><p>¿Quitar el acceso y desconectar sus dispositivos de esta casa?</p><button type="button" className="text-button danger" disabled={pending} onClick={() => { void update({ action: 'remove', email: resident.email }); }}>Sí, quitar acceso</button><button type="button" className="text-button" disabled={pending} onClick={() => setRemoving('')}>Cancelar</button></div>
          : <button type="button" className="icon-button" aria-label={`Quitar acceso a ${resident.email}`} disabled={pending} onClick={() => { setRemoving(resident.email); setError(''); }}><Trash2 size={17} /></button>)}
      </div>}
    </div>)}
    <button type="button" className="text-button" disabled={pending} onClick={() => { void update(); }}><RefreshCw size={15} />Actualizar residentes</button>
  </section>;
}
