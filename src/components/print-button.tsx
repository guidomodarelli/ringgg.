'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { LoaderCircle, Printer } from 'lucide-react';
import { isInstalledAppleApp, isShareCancelled, needsShareToSave } from '@/lib/share-sheet';

/** The PDF of the poster the installed iPhone app shares, built before the tap. */
type PosterPdf = { status: 'preparing' } | { status: 'ready'; file: File } | { status: 'failed' };

const noSubscription = () => () => {};

/** Read after hydration: the server and the first render on the client both say "not installed". */
function useInstalledAppleApp() {
  return useSyncExternalStore(noSubscription, () => isInstalledAppleApp(navigator), () => false);
}

/**
 * Prints the poster; the browser's print dialog also saves it as a PDF. The app installed from Safari
 * on iPhone ignores `window.print()`, so there the button opens the share sheet with the poster as a
 * PDF of the sticker sheet, which offers «Imprimir» and «Guardar en Archivos». The PDF is built when
 * the page opens, because iOS drops a share that does not start right in the tap.
 */
export function PrintButton({ homeName, url }: { homeName: string; url: string }) {
  const installed = useInstalledAppleApp();
  const [pdf, setPdf] = useState<PosterPdf>({ status: 'preparing' });
  const [attempt, setAttempt] = useState(0);
  const [shareError, setShareError] = useState('');
  useEffect(() => {
    if (!installed) return;
    let active = true;
    import('@/lib/poster-pdf').then(({ buildPosterPdf }) => buildPosterPdf({ homeName, url }))
      .then((file) => { if (active) setPdf({ status: 'ready', file }); })
      .catch((error: unknown) => {
        console.error('PrintButton:buildPosterPdf failed', { attempt, error });
        if (active) setPdf({ status: 'failed' });
      });
    return () => { active = false; };
  }, [installed, homeName, url, attempt]);
  const preparing = installed && pdf.status === 'preparing';
  const failed = installed && pdf.status === 'failed';

  function print() {
    if (!installed) { window.print(); return; }
    if (pdf.status !== 'ready') return;
    if (!needsShareToSave(navigator, pdf.file)) { setShareError('Este iPhone no deja imprimir desde la app instalada. Abrí ringgg en Safari para imprimir el cartel.'); return; }
    setShareError('');
    navigator.share({ files: [pdf.file] }).catch((error: unknown) => { if (!isShareCancelled(error)) setShareError('No pudimos abrir las opciones para imprimir. Probá de nuevo.'); });
  }
  function retry() {
    setPdf({ status: 'preparing' });
    setAttempt((count) => count + 1);
  }

  return <div className="print-action">
    <button type="button" className="button primary" disabled={preparing || failed} aria-busy={preparing || undefined} onClick={print}>
      {preparing ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Printer size={17} aria-hidden="true" />} Imprimir o guardar PDF
    </button>
    {failed && <p className="print-feedback" role="alert">No pudimos preparar el PDF del cartel. <button type="button" className="text-button" onClick={retry}>Reintentar</button></p>}
    {!failed && shareError && <p className="print-feedback" role="alert">{shareError}</p>}
  </div>;
}
