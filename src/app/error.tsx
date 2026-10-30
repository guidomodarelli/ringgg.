'use client';
import { useEffect } from 'react';
import Link from 'next/link';
export default function ErrorPage({ error, reset, retry }: { error: Error & { digest?: string }; reset: () => void; retry: () => void }) {
  useEffect(() => { console.error('Ringgg:route render failed', { digest: error.digest }); }, [error]);
  // Going home from the failed `/` keeps the pathname, which alone does not clear the error: `retry` fetches again.
  return <main className="message-page"><h1>No pudimos cargar tu timbre.</h1><p>Revisá tu conexión y volvé a intentar.{error.digest && ` Referencia: ${error.digest}`}</p><button className="button primary" onClick={reset}>Reintentar</button><Link href="/" onNavigate={retry}>Volver al inicio</Link></main>;
}
