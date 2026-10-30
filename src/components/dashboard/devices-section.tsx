import { useState } from 'react';
import { Bell, Laptop, Smartphone, Trash2 } from 'lucide-react';
import type { Device } from '@/types/doorbell';
import { api } from '@/lib/api';
import type { RunAction } from './types';

export function DevicesSection({ devices, pending, run }: { devices: Device[]; pending: string; run: RunAction }) {
  const [confirmRemoval, setConfirmRemoval] = useState('');
  return <section id="devices" className="section-block lower-section"><div className="section-title"><div><span className="eyebrow">QUE NO SE TE ESCAPE UN DING</span><h2>Los celulares de tu casa</h2><p>Todos reciben el aviso. Cualquiera puede responder.</p></div><Laptop size={25} /></div>
    {devices.length === 0 && <p className="section-footnote">Todavía no hay dispositivos conectados. El historial funciona; para recibir avisos con la app cerrada, conectá tu celular.</p>}
    {devices.map((device) => <div className="device-row" key={device.id}><Smartphone size={23} /><div><strong>{device.name}</strong><span>Conectado a tu casa</span></div>
      <button className="text-button" disabled={!!pending} onClick={() => run(`test-${device.id}`, () => api('test-push', { id: device.id }), 'El servicio aceptó la prueba. Revisá el celular; la entrega depende de su conexión y ajustes.')}><Bell size={16} /> Probar aviso</button>
      {confirmRemoval === device.id ? <><span>¿Desconectar?</span><button className="text-button danger" disabled={!!pending} onClick={() => { void run(`remove-${device.id}`, () => api('remove-device', { id: device.id }), 'Dispositivo desconectado.').then((success) => { if (success) setConfirmRemoval(''); }); }}>Sí</button><button className="text-button" onClick={() => setConfirmRemoval('')}>Cancelar</button></>
        : <button className="icon-button" aria-label={`Desconectar ${device.name}`} onClick={() => setConfirmRemoval(device.id)}><Trash2 size={17} /></button>}
    </div>)}
  </section>;
}
