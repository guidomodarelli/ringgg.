import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PrintButton } from '@/components/print-button';
import { HOMES } from '@/constants/homes';
import { POSTER_COPY, POSTER_SHEET } from '@/constants/poster';
import { posterStyle } from '@/lib/poster-layout';

const MM_PER_CM = 10;

/** The print dialog starts on the sticker sheet, without margins, so the poster fills it edge to edge. */
const PRINT_PAGE_RULE = `@media print{@page{size:${POSTER_SHEET.widthMm}mm ${POSTER_SHEET.heightMm}mm;margin:0}}`;

/**
 * The poster for the door of a home on its 10 × 15 cm sheet, shown as it prints: the QR with the home
 * name and instructions for a visitor who has never seen Ringgg. Only the print button is a client leaf.
 */
export function PosterView({ homeId, homeName, url, qrSvg }: { homeId: number; homeName: string; url: string; qrSvg: string }) {
  return <main className="poster-page">
    <style>{PRINT_PAGE_RULE}</style>
    <div className="poster-toolbar">
      <Link className="text-button" href={`/?${HOMES.queryParameter}=${homeId}&view=qr`}><ArrowLeft size={16} /> Volver al panel</Link>
      <PrintButton homeName={homeName} url={url} />
    </div>
    <div className="poster-sheet" style={posterStyle(homeName)}>
      <article className="poster" aria-labelledby="poster-title">
        <p className="poster-eyebrow">{POSTER_COPY.eyebrow}</p>
        <h1 id="poster-title">{homeName}<span>{POSTER_COPY.titleEnd}</span></h1>
        <div className="poster-qr-slot">
          {/* An inline SVG data URL: there is nothing to optimize, and printing needs it loaded. */}
          <Image className="poster-qr" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`} alt={`Código QR para tocar el timbre de ${homeName}`} width={320} height={320} unoptimized loading="eager" />
        </div>
        <ol className="poster-steps">{POSTER_COPY.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        <p className="poster-note">{POSTER_COPY.note}</p>
        <p className="poster-brand">{POSTER_COPY.brand}</p>
      </article>
    </div>
    <p className="poster-hint">Se imprime en una hoja de {POSTER_SHEET.widthMm / MM_PER_CM} × {POSTER_SHEET.heightMm / MM_PER_CM} cm, como las de papel adhesivo. Si regenerás el QR desde el panel, este cartel deja de funcionar y hay que volver a imprimirlo.</p>
  </main>;
}
