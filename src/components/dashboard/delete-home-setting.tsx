'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { HOMES } from '@/constants/homes';
import { api } from '@/lib/api';

/** Why the home cannot be deleted, so the disabled button is never a dead end. */
function blockedReason(residents: number, homes: number) {
  if (residents > 1) return 'Hay otros residentes en esta casa. Si ya no querés recibir sus visitas, quitate desde Residentes.';
  if (homes <= 1) return 'Es tu única casa, así que no se puede eliminar.';
  return '';
}

/**
 * Deleting a home removes its visits, residents and device registrations. Only its sole resident can,
 * while they keep another home; the server enforces the same rules. It asks for confirmation first.
 */
export function DeleteHomeSetting({ homeId, homeName, residents, homes }: { homeId: number; homeName: string; residents: number; homes: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const reason = blockedReason(residents, homes);
  async function remove() {
    if (lock.current) return;
    lock.current = true; setPending(true); setError('');
    try {
      const { nextHomeId } = await api<{ nextHomeId: number }>('delete-home', { home: homeId });
      router.replace(`/?${HOMES.queryParameter}=${nextHomeId}`);
      router.refresh();
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : 'No pudimos eliminar la casa. Reintentá.'); }
    finally { lock.current = false; setPending(false); }
  }
  return <div className="delete-home">
    <div className="setting-row">
      <div><h3>Eliminar esta casa</h3><p>{reason || 'Se borran su historial, su QR y los celulares conectados a ella. No se puede deshacer.'}</p></div>
      <button type="button" className="text-button danger" disabled={Boolean(reason) || pending} onClick={() => { setConfirming(true); setError(''); }}><Trash2 size={16} /> Eliminar casa</button>
    </div>
    {confirming && !reason && <div className="confirm-box" role="group" aria-labelledby="delete-home-question">
      <p id="delete-home-question">¿Eliminar «{homeName}» con su historial y sus celulares? El QR pegado en la puerta deja de funcionar.</p>
      <button type="button" className="button primary small" disabled={pending} onClick={() => { void remove(); }}>{pending ? 'Eliminando…' : 'Sí, eliminar casa'}</button>
      <button type="button" className="text-button" disabled={pending} onClick={() => setConfirming(false)}>Cancelar</button>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>}
  </div>;
}
