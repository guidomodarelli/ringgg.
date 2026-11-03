import { redirect } from 'next/navigation';
import { PosterView } from '@/components/poster-view';
import { posterQrSvg } from '@/lib/poster-qr';
import { identityWithDatabase } from '@/server/page-session';
import { getConfig } from '@/server/config';
import { getHome } from '@/server/doorbell';
import { choosePanelHome } from '@/server/panel-home';

export const dynamic = 'force-dynamic';

/** Printable poster for the door of one home (`?home=<id>`), rendered on the server. */
export default async function PosterPage({ searchParams }: { searchParams: Promise<{ home?: string }> }) {
  const [user, database] = await identityWithDatabase();
  const { homeId } = await choosePanelHome(database, user, (await searchParams).home);
  if (homeId === null) redirect('/');
  const home = await getHome(database, homeId);
  const url = `${getConfig().origin}/t/${home.token}`;
  return <PosterView homeId={home.id} homeName={home.name} url={url} qrSvg={await posterQrSvg(url)} />;
}
