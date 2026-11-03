import { posterStyle } from '@/lib/poster-layout';

/** Same shape as the poster: toolbar, then the sticker sheet with title, QR and steps. */
export default function PosterLoading() {
  return <main className="poster-page" role="status" aria-label="Preparando el cartel">
    <div className="poster-toolbar"><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" /></div>
    <div className="poster-sheet" style={posterStyle('')}><div className="poster"><div className="skeleton skeleton-title" /><div className="poster-qr-slot"><div className="skeleton poster-qr-skeleton" /></div><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" /></div></div>
    <span className="sr-only">Preparando el cartel</span>
  </main>;
}
