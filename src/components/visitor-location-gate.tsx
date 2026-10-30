'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { currentPosition, locationFailure, type LocationFailure } from '@/lib/browser-location';
import { phonePlatform, useBrowserUserAgent } from './use-browser-user-agent';

/** `ready` only after a reading this visit: a granted permission alone does not prove the device can locate itself. */
export type LocationGateState = 'checking' | 'needed' | 'denied' | 'failed' | 'ready';

/** What the browser says before asking; without the Permissions API it has to be asked. */
async function permissionState(): Promise<PermissionState> {
  if (!('permissions' in navigator)) return 'prompt';
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { return 'prompt'; }
}

/**
 * Location for a home that only rings from its door. Until this browser shares a reading, the visitor
 * cannot ring; a permission changed in the browser settings is noticed while the page is open.
 */
export function useLocationGate(required: boolean) {
  const [state, setState] = useState<LocationGateState>('checking');
  const [failure, setFailure] = useState<LocationFailure | null>(null);
  const mounted = useRef(true);

  const recordFailure = useCallback((reason: LocationFailure) => {
    setFailure(reason);
    setState(reason === 'denied' ? 'denied' : 'failed');
  }, []);

  /** Asks the browser for a reading: the first time this shows its permission prompt. */
  const request = useCallback(async () => {
    try {
      await currentPosition();
      if (mounted.current) { setFailure(null); setState('ready'); }
    } catch (error) {
      if (mounted.current) recordFailure(locationFailure(error));
    }
  }, [recordFailure]);

  useEffect(() => {
    mounted.current = true;
    if (!required) return () => { mounted.current = false; };
    let status: PermissionStatus | undefined;
    const reevaluate = () => { void evaluate(); };
    async function evaluate() {
      const permission = await permissionState();
      if (!mounted.current) return;
      if (permission === 'denied') recordFailure('denied');
      else if (permission === 'granted') await request();
      else setState('needed');
    }
    void evaluate();
    if ('permissions' in navigator) {
      navigator.permissions.query({ name: 'geolocation' })
        .then((current) => { status = current; current.addEventListener('change', reevaluate); })
        .catch(() => undefined);
    }
    return () => { mounted.current = false; status?.removeEventListener('change', reevaluate); };
  }, [required, request, recordFailure]);

  return { state: required ? state : 'ready', failure, request, recordFailure };
}

/** How to allow location again after blocking it, on the visitor's kind of phone. */
function UnblockSteps() {
  const platform = phonePlatform(useBrowserUserAgent());
  const ios = <li><strong>iPhone:</strong> Ajustes → Privacidad y seguridad → Localización → tu navegador (por ejemplo Safari) → «Al usar la app». Si sigue bloqueada, tocá «aA» en la barra de direcciones → Configuración del sitio web → Ubicación → Permitir.</li>;
  const android = <li><strong>Android:</strong> tocá el ícono junto a la dirección de esta página → Permisos → Ubicación → Permitir. Revisá también que la ubicación del celular esté activada.</li>;
  return <ol className="location-steps">
    {platform !== 'android' && ios}
    {platform !== 'ios' && android}
  </ol>;
}

function gateAction(state: LocationGateState) {
  if (state === 'needed') return 'Permitir ubicación';
  return state === 'denied' ? 'Ya la activé, volver a comprobar' : 'Volver a intentar';
}

function failureDetail(failure: LocationFailure | null) {
  if (failure === 'unsupported') return 'Este navegador no puede compartir tu ubicación. Abrí el enlace del QR en otro navegador, como Safari o Chrome.';
  if (failure === 'timeout') return 'Tu celular tardó demasiado en encontrar tu ubicación. Revisá que esté activada y volvé a intentar.';
  return 'Tu celular no encontró tu ubicación. Revisá que esté activada y volvé a intentar.';
}

/**
 * The notice a visitor cannot skip while this home asks for their location: Escape does not close it,
 * it has no close button and the doorbell form only exists once a reading arrived.
 */
export function LocationGate({ homeName, state, failure, onRequest }: { homeName: string; state: LocationGateState; failure: LocationFailure | null; onRequest: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  const ask = () => { setPending(true); void onRequest().finally(() => setPending(false)); };
  return <dialog ref={dialog} className="notification-onboarding location-gate" aria-labelledby="location-gate-title" aria-describedby="location-gate-description" onCancel={(event) => event.preventDefault()}>
    <div className="notification-onboarding-icon"><MapPin size={36} /></div>
    <span className="eyebrow">ANTES DE TOCAR</span>
    <h2 id="location-gate-title">Este timbre necesita tu ubicación<span>.</span></h2>
    <p id="location-gate-description">«{homeName}» solo recibe timbrazos desde la puerta. Tu ubicación se usa únicamente para comparar la distancia y no se guarda.</p>
    {state === 'denied' && <div className="notification-onboarding-help" role="alert"><p>Bloqueaste la ubicación para esta página, y sin ella no se puede tocar este timbre. Para activarla:</p><UnblockSteps /></div>}
    {state === 'failed' && <p className="notification-onboarding-help" role="alert">{failureDetail(failure)}</p>}
    <button type="button" className="button primary notification-onboarding-primary" disabled={pending} onClick={ask}>{pending ? 'Buscando tu ubicación…' : gateAction(state)}</button>
  </dialog>;
}
