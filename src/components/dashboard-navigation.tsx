'use client';
import { BellRing, House, QrCode, Settings2, Smartphone, Users, type LucideIcon } from 'lucide-react';
import { AWAITING_ANSWER_VIEW, type DashboardView } from '@/constants/dashboard-views';
import { DashboardSectionLink } from './dashboard-section-link';
import { useDashboardView } from './dashboard/use-dashboard-view';
import { useAwaitingVisitCount } from './dashboard/use-awaiting-visits';

const LINKS: Array<{ view: DashboardView; label: string; Icon: LucideIcon }> = [
  { view: 'overview', label: 'Resumen', Icon: House },
  { view: 'history', label: 'Timbrazos', Icon: BellRing },
  { view: 'qr', label: 'Mi código QR', Icon: QrCode },
  { view: 'devices', label: 'Dispositivos', Icon: Smartphone },
  { view: 'residents', label: 'Residentes', Icon: Users },
  { view: 'settings', label: 'Configuración', Icon: Settings2 },
];

/**
 * Every resident shares the same permissions, so every section is available to everyone. While a visit
 * waits for an answer, «Timbrazos» shows how many, also in its accessible name («Timbrazos, 1 por responder»).
 */
export function DashboardNavigation({ initialView, homeId }: { initialView: DashboardView; homeId: number }) {
  const view = useDashboardView(initialView);
  const awaiting = useAwaitingVisitCount(homeId);
  return <nav aria-label="Navegación principal">{LINKS.map(({ view: target, label, Icon }) => {
    const count = target === AWAITING_ANSWER_VIEW ? awaiting : 0;
    return <DashboardSectionLink key={target} view={target} homeId={homeId} className={view === target ? 'nav-home' : undefined} aria-current={view === target ? 'page' : undefined} aria-label={count > 0 ? `${label}, ${count} por responder` : undefined}>
      <Icon size={19} />{label}{count > 0 && <span className="nav-badge" aria-hidden="true">{count}</span>}{view === target && <span className="nav-dot" />}
    </DashboardSectionLink>;
  })}</nav>;
}
