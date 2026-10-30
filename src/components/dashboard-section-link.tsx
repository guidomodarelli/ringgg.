'use client';
import Link from 'next/link';
import type { ComponentProps, MouseEvent } from 'react';
import type { DashboardView } from '@/constants/dashboard-views';
import { dashboardHref, navigateDashboard } from '@/lib/dashboard-view';

type DashboardSectionLinkProps = Omit<ComponentProps<typeof Link>, 'href' | 'prefetch' | 'onClick'> & { view: DashboardView; homeId: number };

/**
 * Link to a section of the current home. A plain click switches the section in place, keeping unsaved
 * inputs and skipping a reload; a modified click (new tab or window) keeps the browser's behavior.
 * Sections render from data the panel already has, so there is nothing to prefetch.
 */
export function DashboardSectionLink({ view, homeId, ...props }: DashboardSectionLinkProps) {
  function openInPlace(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateDashboard(view, homeId);
  }
  return <Link {...props} href={dashboardHref(view, homeId)} prefetch={false} onClick={openInPlace} />;
}
