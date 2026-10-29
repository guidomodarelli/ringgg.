'use client';
export default function GlobalError({ reset }: { reset: () => void }) {
  return <html lang="es"><body><main><h1>No pudimos abrir Ringgg</h1><p>Volvé a intentar en un momento.</p><button onClick={reset}>Reintentar</button></main></body></html>;
}
