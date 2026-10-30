'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { DOORBELL } from '@/constants/doorbell';
import { HOMES } from '@/constants/homes';
import { api } from '@/lib/api';
import { cleanName } from '@/lib/names';
import type { HomeSummary } from '@/types/residents';

function homeHref(homeId: number) {
  return `/?${HOMES.queryParameter}=${homeId}`;
}

/** Creates another home; the panel opens it once the server confirms. Errors stay next to the field. */
function NewHomeForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  async function create() {
    if (lock.current || !cleanName(name)) return;
    lock.current = true; setPending(true); setError('');
    try {
      const created = await api<{ id: number }>('homes', { name: cleanName(name) });
      router.push(homeHref(created.id));
    } catch (createError) { setError(createError instanceof Error ? createError.message : 'No pudimos crear la casa. Reintentá.'); }
    finally { lock.current = false; setPending(false); }
  }
  return <form className="home-switcher-form" onSubmit={(event) => { event.preventDefault(); void create(); }}>
    <label htmlFor="new-home-name">Nombre de la nueva casa</label>
    <input id="new-home-name" value={name} required maxLength={DOORBELL.nameMaxLength} disabled={pending} placeholder="Casa de mamá"
      aria-invalid={error ? true : undefined} aria-describedby={error ? 'new-home-error' : undefined}
      onChange={(event) => { setName(event.target.value); setError(''); }} />
    {error && <p id="new-home-error" className="field-error" role="alert">{error}</p>}
    <div className="home-switcher-actions">
      <button className="button primary small" disabled={pending || !cleanName(name)}>{pending ? 'Creando…' : 'Crear casa'}</button>
      <button type="button" className="text-button" disabled={pending} onClick={onCancel}>Cancelar</button>
    </div>
  </form>;
}

/**
 * The homes of the resident, in the top bar on every screen size: switching opens the other home's
 * panel, and "Agregar casa" creates a new one.
 */
export function HomeSwitcher({ homes, currentId, currentName }: { homes: HomeSummary[]; currentId: number; currentName: string }) {
  const [creating, setCreating] = useState(false);
  return <details className="home-switcher">
    <summary aria-label={`Casa: ${currentName}. Cambiar de casa o agregar una`}><strong>{currentName}</strong><ChevronDown size={14} aria-hidden="true" /></summary>
    <div className="home-switcher-menu">
      <p className="home-switcher-title">Tus casas</p>
      <ul>{homes.map((home) => <li key={home.id}>
        <Link href={homeHref(home.id)} prefetch={false} aria-current={home.id === currentId ? 'page' : undefined}>{home.name}{home.id === currentId && <Check size={14} aria-hidden="true" />}</Link>
      </li>)}</ul>
      {creating
        ? <NewHomeForm onCancel={() => setCreating(false)} />
        : <button type="button" className="text-button home-switcher-add" onClick={() => setCreating(true)}><Plus size={15} /> Agregar casa</button>}
    </div>
  </details>;
}
