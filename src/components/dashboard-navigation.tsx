'use client';
import { useEffect, useState } from 'react';
import { BellRing, House, QrCode, Settings2, Smartphone, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DASHBOARD_VIEW_EVENT, type DashboardView } from '@/constants/dashboard-views';
import { getDashboardView, navigateDashboard } from '@/lib/dashboard-view';

export function DashboardNavigation({ initialView, isAdmin }: { initialView: DashboardView; isAdmin: boolean }) {
  const [view, setView] = useState(initialView);
  useEffect(() => {
    const update = () => setView(getDashboardView(window.location.search, window.location.hash));
    update(); window.addEventListener('popstate', update); window.addEventListener(DASHBOARD_VIEW_EVENT, update);
    return () => { window.removeEventListener('popstate', update); window.removeEventListener(DASHBOARD_VIEW_EVENT, update); };
  }, []);
  const links: Array<{ view: DashboardView; label: string; Icon: LucideIcon }> = [
    { view: 'overview', label: 'Resumen', Icon: House },
    { view: 'history', label: 'Timbrazos', Icon: BellRing },
    { view: 'qr', label: 'Mi código QR', Icon: QrCode },
    { view: 'devices', label: 'Dispositivos', Icon: Smartphone },
    ...(isAdmin ? [{ view: 'residents' as const, label: 'Residentes', Icon: Users }] : []),
    { view: 'settings', label: 'Configuración', Icon: Settings2 },
  ];
  return <nav aria-label="Navegación principal">{links.map(({ view: target, label, Icon }) => <a key={target} href={target === 'overview' ? '/' : `/?view=${target}`} className={view === target ? 'nav-home' : undefined} aria-current={view === target ? 'page' : undefined} onClick={(event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigateDashboard(target);
  }}><Icon size={19} />{label}{view === target && <span className="nav-dot" />}</a>)}</nav>;
}
