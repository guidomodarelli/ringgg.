import { BellRing, House, QrCode, Smartphone, Settings2, ArrowUpRight } from 'lucide-react';
import { ResidentBrand } from '@/components/resident-brand';
import { Login } from '@/components/login';
import { GoogleLogin } from '@/components/google-login';
import { isSelfManagedAuth } from '@/server/auth-mode';
import { Dashboard } from '@/components/dashboard';
import { DashboardNavigation } from '@/components/dashboard-navigation';
import { getDashboardView } from '@/lib/dashboard-view';
import { getIdentity } from '@/server/auth';
import { redirect } from 'next/navigation';
import { resolveResidentAccess, listResidents } from '@/server/residents';
import { AppError } from '@/server/errors';
import { getConfig } from '@/server/config';
import { getDatabase } from '@/server/database';
import { snapshot } from '@/server/doorbell';
import { visitFromUrl } from '@/lib/visit-format';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string; visit?: string }> }) {
  const query = await searchParams;
  const requestedView = getDashboardView(query.view ? `?view=${encodeURIComponent(query.view)}` : '');
  const focusVisitId = typeof query.visit === 'string' ? visitFromUrl(`/?visit=${encodeURIComponent(query.visit)}`) : '';
  const config = getConfig();
  const user = await getIdentity();
  if (!user) redirect('/sign-in');
  let accessError = '';
  let isAdmin = false;
  try { isAdmin = (await resolveResidentAccess(await getDatabase(), user)).isAdmin; }
  catch (error) { if (!(error instanceof AppError)) throw error; accessError = error.message; }
  if (accessError) return isSelfManagedAuth() ? <GoogleLogin configured signedIn initialMessage={accessError} clientId={process.env.GOOGLE_CLIENT_ID || ''} /> : <Login configured initialMessage={accessError} signedIn={user.emailVerified} initialEmail={user.email} initialMode={user.emailVerified ? undefined : 'verify'} />;
  const database = await getDatabase();
  const initialView = requestedView === 'residents' && !isAdmin ? 'overview' : requestedView;
  const [data, residents] = await Promise.all([
    snapshot(database),
    isAdmin ? listResidents(database, { ...user, isAdmin }) : Promise.resolve([]),
  ]);
  return <div className="app-shell"><a className="skip-link" href="#main">Ir al contenido</a><aside className="sidebar"><ResidentBrand /><div className="house-selector"><span className="house-avatar"><House size={20} /></span><span><strong>{data.home.name}</strong><small>Mi vivienda</small></span><span className="selector-mark">⌄</span></div><span className="nav-label">MI ESPACIO</span><DashboardNavigation initialView={initialView} isAdmin={isAdmin} /><div className="sidebar-bottom"><div className="sidebar-tip"><span className="little-star">✳</span><strong>Una casa conectada.<br />Una cosa menos.</strong><p>Agregá Ringgg a tu pantalla de inicio y tené tu timbre siempre a mano.</p><a href="/?view=devices">Empezar <ArrowUpRight size={15} /></a></div><div className="resident-avatar"><span>R</span><div><strong>Residente</strong><small>Tu espacio privado</small></div><span className="online-dot" /></div></div></aside><div className="workspace"><Dashboard initialView={initialView} initial={{ ...data, pushReady: !!config.publicKey && !!config.privateKey, origin: config.origin, isAdmin, residents, focusVisitId }} /></div></div>;
}
