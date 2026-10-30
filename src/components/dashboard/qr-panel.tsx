import { useEffect, useState } from 'react';
import Image from 'next/image';
import { ArrowDownToLine, Copy, Printer, QrCode, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import type { RunAction } from './types';

export function QrPanel({ url, homeId, homeName, pending, run, onFeedback, onError }: { url: string; homeId: number; homeName: string; pending: string; run: RunAction; onFeedback: (message: string) => void; onError: (message: string) => void }) {
  const [qr, setQr] = useState('');
  const [confirmRotation, setConfirmRotation] = useState(false);
  const busy = Boolean(pending);
  useEffect(() => {
    let active = true;
    // The encoder loads after hydration, outside the panel's initial JavaScript.
    import('qrcode').then(({ default: QRCode }) => QRCode.toDataURL(url, { width: 768, margin: 2, color: { dark: '#252a28', light: '#ffffff' } })).then((image) => { if (active) setQr(image); }).catch(() => { if (active) onError('No pudimos generar el QR. Recargá la página.'); });
    return () => { active = false; };
  }, [url, onError]);
  async function copy() {
    try { await navigator.clipboard.writeText(url); onFeedback('Enlace del timbre copiado.'); }
    catch { onError('No pudimos copiarlo. Abrí tu timbre y copiá la dirección.'); }
  }
  return <section className="qr-section" id="qr"><div className="section-title"><h2>Tu puerta de entrada</h2><QrCode size={20} /></div><p>Escaneá. Tocá. Ya estás cerca.</p>
    {/* A data URL drawn in the browser: there is nothing to optimize. */}
    <div className="qr-frame">{qr ? <Image src={qr} width={184} height={184} alt={`QR para tocar el timbre de ${homeName}`} unoptimized loading="eager" /> : <div className="skeleton qr-skeleton" />}</div>
    <strong className="qr-home">{homeName}</strong><span className="qr-caption">No hace falta descargar ninguna app.</span>
    <a className="button primary full" href={`/cartel?home=${homeId}`}><Printer size={17} /> Imprimir cartel para la puerta</a>
    <a className={`button outline full ${!qr ? 'disabled' : ''}`} href={qr || undefined} download="ringgg-mi-timbre.png"><ArrowDownToLine size={17} /> Descargar QR</a>
    <button className="text-button centered" onClick={() => { void copy(); }}><Copy size={15} /> Copiar enlace</button>
    <div className="setting-row"><div><h3>Un enlace nuevo</h3><p>Regenerar el QR desactiva el anterior. Vas a tener que volver a imprimirlo.</p></div><button className="text-button" disabled={busy} onClick={() => setConfirmRotation(true)}><RefreshCw size={16} /> Regenerar QR</button></div>
    {confirmRotation && <div className="confirm-box" role="alert"><p>El QR pegado en tu puerta dejará de funcionar. ¿Querés crear uno nuevo?</p><button className="button primary small" disabled={busy} onClick={() => { void run('rotate', () => api('rotate', { home: homeId }), 'Nuevo QR creado. Descargalo y reemplazá el anterior.', 'snapshot').then((success) => { if (success) setConfirmRotation(false); }); }}>Sí, crear nuevo QR</button><button className="text-button" onClick={() => setConfirmRotation(false)}>Cancelar</button></div>}
  </section>;
}
