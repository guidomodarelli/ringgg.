'use client';
import { useEffect } from 'react';
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('Ringgg:route render failed', { digest: error.digest }); }, [error]);
  return <main className="message-page"><h1>No pudimos cargar tu timbre.</h1><p>Revisá tu conexión y volvé a intentar.{error.digest && ` Referencia: ${error.digest}`}</p><button className="button primary" onClick={reset}>Reintentar</button><a href="/">Volver al inicio</a></main>;
}
