import { redirect } from 'next/navigation';
import { Login } from '@/components/login';
import { GoogleLogin } from '@/components/google-login';
import { Dashboard } from '@/components/dashboard';
import { DashboardSidebar } from '@/components/dashboard-sidebar';
import { HOMES } from '@/constants/homes';
import { isSelfManagedAuth } from '@/server/auth-mode';
import { getDashboardView } from '@/lib/dashboard-view';
import { visitFromUrl } from '@/lib/visit-format';
import { getIdentity } from '@/server/auth';
import { listResidents, resolveHomeAccess, suggestedResidentName } from '@/server/residents';
import { AppError } from '@/server/errors';
import { chatSettings } from '@/server/chat';
import { getConfig, pushConfigured } from '@/server/config';
import { getDatabase } from '@/server/database';
import { snapshot } from '@/server/doorbell';
import { choosePanelHome } from '@/server/panel-home';
import type { HomeMember } from '@/types/residents';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string; visit?: string; home?: string }> }) {
  const query = await searchParams;
  const initialView = getDashboardView(query.view ? `?view=${encodeURIComponent(query.view)}` : '');
  const focusVisitId = typeof query.visit === 'string' ? visitFromUrl(`/?visit=${encodeURIComponent(query.visit)}`) : '';
  const config = getConfig();
  const user = await getIdentity();
  if (!user) redirect('/sign-in');
  const database = await getDatabase();
  const { homes, homeId } = await choosePanelHome(database, user, query.home);
  let member: HomeMember | null = null;
  let accessError = '';
  // Without any home, the original home's check explains why: unverified email or not invited.
  try { member = await resolveHomeAccess(database, user, homeId ?? HOMES.originalId); }
  catch (error) { if (!(error instanceof AppError)) throw error; accessError = error.message; }
  if (!member) return isSelfManagedAuth()
    ? <GoogleLogin configured signedIn initialMessage={accessError} clientId={process.env.GOOGLE_CLIENT_ID || ''} />
    : <Login configured initialMessage={accessError} signedIn={user.emailVerified} initialEmail={user.email} initialMode={user.emailVerified ? undefined : 'verify'} />;
  const [data, residents, suggestedName] = await Promise.all([snapshot(database, member.homeId), listResidents(database, member.homeId), suggestedResidentName(database, user)]);
  const viewer = { name: member.displayName, suggestedName, email: user.email };
  return <div className="app-shell">
    <a className="skip-link" href="#main">Ir al contenido</a>
    <DashboardSidebar homeId={member.homeId} homeName={data.home.name} viewer={viewer} initialView={initialView} />
    <div className="workspace"><Dashboard key={member.homeId} initialView={initialView} initial={{ ...data, pushReady: pushConfigured(config), origin: config.origin, viewer, homes, residents, focusVisitId, chatEnabled: chatSettings() !== null }} /></div>
  </div>;
}
