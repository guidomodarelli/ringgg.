import { ArrowUpRight, House } from 'lucide-react';
import { ResidentBrand } from './resident-brand';
import { DashboardNavigation } from './dashboard-navigation';
import { DashboardSectionLink } from './dashboard-section-link';
import type { DashboardView } from '@/constants/dashboard-views';
import type { Viewer } from '@/types/doorbell';

/** Server-rendered chrome: only the logo and the section links are client leaves. */
export function DashboardSidebar({ homeId, homeName, viewer, initialView }: { homeId: number; homeName: string; viewer: Viewer; initialView: DashboardView }) {
  // Until the resident chooses a name in this home, the sidebar shows the suggestion.
  const name = viewer.name ?? viewer.suggestedName;
  return <aside className="sidebar">
    <ResidentBrand homeId={homeId} />
    <div className="house-selector"><span className="house-avatar"><House size={20} /></span><span><strong>{homeName}</strong><small>Mi vivienda</small></span></div>
    <span className="nav-label">MI ESPACIO</span>
    <DashboardNavigation initialView={initialView} homeId={homeId} />
    <div className="sidebar-bottom">
      <div className="sidebar-tip"><span className="little-star">✳</span><strong>Una casa conectada.<br />Una cosa menos.</strong><p>Agregá Ringgg a tu pantalla de inicio y tené tu timbre siempre a mano.</p><DashboardSectionLink view="devices" homeId={homeId}>Empezar <ArrowUpRight size={15} /></DashboardSectionLink></div>
      <div className="resident-avatar"><span aria-hidden="true">{name.trim().charAt(0).toUpperCase() || 'R'}</span><div><strong>{name}</strong><small>{viewer.email}</small></div><span className="online-dot" /></div>
    </div>
  </aside>;
}
