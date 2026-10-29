import { BellRing, House, QrCode, Smartphone, Settings2, ArrowUpRight } from 'lucide-react';
import { Brand } from '@/components/brand';
import { Login } from '@/components/login';
import { Dashboard } from '@/components/dashboard';
import { authenticated } from '@/server/auth';
import { getConfig } from '@/server/config';
import { getDatabase } from '@/server/database';
import { snapshot } from '@/server/doorbell';

export const dynamic = 'force-dynamic';
export default async function Page() {
  const config = getConfig();
  if (!(await authenticated())) return <Login />;
  const data = await snapshot(await getDatabase());
  return <div className="app-shell"><a className="skip-link" href="#main">Ir al contenido</a><aside className="sidebar"><Brand /><div className="house-selector"><span className="house-avatar"><House size={20} /></span><span><strong>{data.home.name}</strong><small>Mi vivienda</small></span><span className="selector-mark">⌄</span></div><span className="nav-label">MI ESPACIO</span><nav aria-label="Navegación principal"><a href="#main" className="nav-home"><House size={19} />Resumen<span className="nav-dot" /></a><a href="#history"><BellRing size={19} />Timbrazos</a><a href="#qr"><QrCode size={19} />Mi código QR</a><a href="#devices"><Smartphone size={19} />Dispositivos</a><a href="#settings"><Settings2 size={19} />Configuración</a></nav><div className="sidebar-bottom"><div className="sidebar-tip"><span className="little-star">✳</span><strong>Una casa conectada.<br />Una cosa menos.</strong><p>Agregá Ringgg a tu pantalla de inicio y tené tu timbre siempre a mano.</p><a href="#devices">Empezar <ArrowUpRight size={15} /></a></div><div className="resident-avatar"><span>R</span><div><strong>Residente</strong><small>Tu espacio privado</small></div><span className="online-dot" /></div></div></aside><div className="workspace"><Dashboard initial={{ ...data, pushReady: !!config.publicKey && !!config.privateKey, origin: config.origin }} /></div></div>;
}
