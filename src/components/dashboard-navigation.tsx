'use client';
import { BellRing, House, QrCode, Settings2, Smartphone, Users, type LucideIcon } from 'lucide-react';
import type { DashboardView } from '@/constants/dashboard-views';
import { DashboardSectionLink } from './dashboard-section-link';
import { useDashboardView } from './dashboard/use-dashboard-view';

const LINKS: Array<{ view: DashboardView; label: string; Icon: LucideIcon }> = [
  { view: 'overview', label: 'Resumen', Icon: House },
  { view: 'history', label: 'Timbrazos', Icon: BellRing },
  { view: 'qr', label: 'Mi código QR', Icon: QrCode },
  { view: 'devices', label: 'Dispositivos', Icon: Smartphone },
  { view: 'residents', label: 'Residentes', Icon: Users },
  { view: 'settings', label: 'Configuración', Icon: Settings2 },
];

/** Every resident shares the same permissions, so every section is available to everyone. */
export function DashboardNavigation({ initialView, homeId }: { initialView: DashboardView; homeId: number }) {
  const view = useDashboardView(initialView);
  return <nav aria-label="Navegación principal">{LINKS.map(({ view: target, label, Icon }) => <DashboardSectionLink key={target} view={target} homeId={homeId} className={view === target ? 'nav-home' : undefined} aria-current={view === target ? 'page' : undefined}>
    <Icon size={19} />{label}{view === target && <span className="nav-dot" />}
  </DashboardSectionLink>)}</nav>;
}
