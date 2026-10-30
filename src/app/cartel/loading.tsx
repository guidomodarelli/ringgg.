/** Same shape as the poster: toolbar, then the card with title, QR and steps. */
export default function PosterLoading() {
  return <main className="poster-page" role="status" aria-label="Preparando el cartel">
    <div className="poster-toolbar"><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" /></div>
    <div className="poster"><div className="skeleton skeleton-title" /><div className="skeleton poster-qr-skeleton" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" /></div>
    <span className="sr-only">Preparando el cartel</span>
  </main>;
}
