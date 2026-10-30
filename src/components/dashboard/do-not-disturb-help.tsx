'use client';
import { MoonStar } from 'lucide-react';
import { phonePlatform, useBrowserUserAgent } from '../use-browser-user-agent';

const IOS_STEPS = [
  'Agregá Ringgg a tu pantalla de inicio (Compartir → Agregar a Inicio) y activá sus notificaciones.',
  'Ajustes → Concentración → No molestar → Apps → Agregar → Ringgg.',
  'Si en Ajustes → Notificaciones → Ringgg aparece la opción de avisos urgentes, activala.',
];

const ANDROID_STEPS = [
  'Ajustes → Notificaciones → No molestar (en algunos celulares, «Modos y rutinas»).',
  'En Apps, agregá Chrome, o Ringgg si la instalaste como app.',
  'Los nombres cambian según la marca del celular; buscá «No molestar» en Ajustes si no lo encontrás.',
];

/**
 * No app can skip Do Not Disturb by itself: only the person can allow it. The steps follow this
 * device's platform; on a computer both are shown, so the resident can set up their phone.
 */
export function DoNotDisturbHelp() {
  const platform = phonePlatform(useBrowserUserAgent());
  return <details className="dnd-help">
    <summary><MoonStar size={16} aria-hidden="true" /> ¿Querés que suene aunque tengas No molestar?</summary>
    <p>Ringgg no puede saltearse No molestar por su cuenta: tenés que permitírselo vos en el celular.</p>
    {platform !== 'android' && <><h4>iPhone</h4><ol>{IOS_STEPS.map((step) => <li key={step}>{step}</li>)}</ol></>}
    {platform !== 'ios' && <><h4>Android</h4><ol>{ANDROID_STEPS.map((step) => <li key={step}>{step}</li>)}</ol></>}
  </details>;
}
