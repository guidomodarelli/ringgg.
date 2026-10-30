import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { ArrowLeft } from 'lucide-react';
import { PrintButton } from '@/components/print-button';
import { HOMES } from '@/constants/homes';
import { getIdentity } from '@/server/auth';
import { getConfig } from '@/server/config';
import { getDatabase } from '@/server/database';
import { getHome } from '@/server/doorbell';
import { choosePanelHome } from '@/server/panel-home';

export const dynamic = 'force-dynamic';

/** Vector QR: it stays sharp at any print size. */
const QR_OPTIONS = { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#252a28', light: '#ffffff' } } as const;

/**
 * Printable poster for the door of one home (`?home=<id>`): the QR with the home name and instructions
 * for a visitor who has never seen Ringgg. Rendered on the server; only the print button is a client leaf.
 */
export default async function PosterPage({ searchParams }: { searchParams: Promise<{ home?: string }> }) {
  const user = await getIdentity();
  if (!user) redirect('/sign-in');
  const database = await getDatabase();
  const { homeId } = await choosePanelHome(database, user, (await searchParams).home);
  if (homeId === null) redirect('/');
  const home = await getHome(database, homeId);
  const url = `${getConfig().origin}/t/${home.token}`;
  const svg = await QRCode.toString(url, QR_OPTIONS);
  return <main className="poster-page">
    <div className="poster-toolbar">
      <Link className="text-button" href={`/?${HOMES.queryParameter}=${home.id}&view=qr`}><ArrowLeft size={16} /> Volver al panel</Link>
      <PrintButton />
    </div>
    <article className="poster" aria-labelledby="poster-title">
      <p className="poster-eyebrow">TIMBRE DIGITAL</p>
      <h1 id="poster-title">{home.name}<span>.</span></h1>
      {/* An inline SVG data URL: there is nothing to optimize, and printing needs it loaded. */}
      <Image className="poster-qr" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={`Código QR para tocar el timbre de ${home.name}`} width={320} height={320} unoptimized loading="eager" />
      <ol className="poster-steps">
        <li>Abrí la cámara del celular y apuntá al código.</li>
        <li>Tocá el enlace y después «Tocar timbre».</li>
        <li>Esperá la respuesta en la misma pantalla.</li>
      </ol>
      <p className="poster-note">No hace falta instalar nada ni registrarse.</p>
      <p className="poster-brand">ringgg.</p>
    </article>
    <p className="poster-hint">Si regenerás el QR desde el panel, este cartel deja de funcionar y hay que volver a imprimirlo.</p>
  </main>;
}
