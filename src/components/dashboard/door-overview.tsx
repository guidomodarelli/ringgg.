import { ArrowUpRight, Bell, BellRing, CheckCheck, Smartphone } from 'lucide-react';
import type { DashboardSnapshot } from '@/types/doorbell';

export function DoorOverview({ url, data }: { url: string; data: DashboardSnapshot }) {
  return <>
    <section className="door-overview" aria-labelledby="door-title"><div className="overview-copy"><span className="label-caps">TU TIMBRE DIGITAL</span><h2 id="door-title">Una puerta.<br />Muchas formas<br />de estar cerca.</h2><p>Un QR en la entrada.<br />Un aviso directo a tu celular.</p><a href={url} target="_blank" rel="noreferrer" className="button dark">Ver mi timbre <ArrowUpRight size={18} /></a></div>
      <div className="door-art" aria-hidden="true"><div className="art-arch"><div className="art-door"><span className="door-panel" /><span className="door-knob" /></div><div className="art-doorbell"><Bell size={18} /></div></div><span className="art-ring ring-one" /><span className="art-ring ring-two" /><div className="art-note"><span className="note-bell"><BellRing size={20} /></span><span><strong>¡Ding, dong!</strong><small>Alguien está en la puerta</small></span></div><span className="art-star">✳</span></div>
    </section>
    <div className="quick-stats">
      <div><span className="stat-icon"><BellRing size={19} /></span><div><strong>{data.visits.length}</strong><span>Timbrazos recientes</span></div></div>
      <div><span className="stat-icon"><Smartphone size={19} /></span><div><strong>{data.devices.length}</strong><span>Dispositivos conectados</span></div></div>
      <div><span className="stat-icon"><CheckCheck size={19} /></span><div><strong>{data.visits.filter((visit) => visit.answered_at).length}</strong><span>Visitas atendidas</span></div></div>
    </div>
  </>;
}
