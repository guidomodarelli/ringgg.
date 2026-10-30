'use client';
import { BrandContents } from './brand';
import { DashboardSectionLink } from './dashboard-section-link';

/** The logo only goes back to the overview, in place: testing notifications has its own button in Devices. */
export function ResidentBrand({ homeId }: { homeId: number }) {
  return <DashboardSectionLink view="overview" homeId={homeId} className="brand" aria-label="Ringgg, volver al resumen"><BrandContents /></DashboardSectionLink>;
}
