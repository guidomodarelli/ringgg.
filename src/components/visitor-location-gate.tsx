'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MapPin } from 'lucide-react';
import { ERROR_CODES } from '@/constants/error-codes';
import { ApiError } from '@/lib/api';
import { currentPosition, locationFailure, type LocationFailure } from '@/lib/browser-location';
import { isImprecise, type Position } from '@/lib/geo';
import { phonePlatform, useBrowserUserAgent } from './use-browser-user-agent';

/**
 * `ready` only after a reading this visit that can place the visitor at the door: a granted permission alone does
 * not prove the device can locate itself, and an approximate reading (`imprecise`) is turned down by the server.
 */
export type LocationGateState = 'checking' | 'needed' | 'denied' | 'failed' | 'imprecise' | 'ready';

/** Why the server turned a ring down for the visitor's location: none sent, too vague, or away from the door. */
export type LocationRejection = 'required' | 'imprecise' | 'far';

const LOCATION_REJECTIONS = new Map<string, LocationRejection>([
  [ERROR_CODES.locationRequired, 'required'],
  [ERROR_CODES.locationImprecise, 'imprecise'],
  [ERROR_CODES.tooFar, 'far'],
]);

/** The location reason of a failed ring, or `null` when it failed for anything else. */
export function locationRejection(error: unknown): LocationRejection | null {
  return error instanceof ApiError && error.code ? LOCATION_REJECTIONS.get(error.code) ?? null : null;
}

/** What the browser says before asking; without the Permissions API it has to be asked. */
async function permissionState(): Promise<PermissionState> {
  if (!('permissions' in navigator)) return 'prompt';
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { return 'prompt'; }
}

/**
 * Location for a home that only rings from its door. Until this browser shares a reading precise enough to place
 * the visitor at the door, they cannot ring; a permission changed in the browser settings is noticed while the
 * page is open.
 */
export function useLocationGate(required: boolean) {
  const [state, setState] = useState<LocationGateState>('checking');
  const [failure, setFailure] = useState<LocationFailure | null>(null);
  const mounted = useRef(true);

  const recordFailure = useCallback((reason: LocationFailure) => {
    setFailure(reason);
    setState(reason === 'denied' ? 'denied' : 'failed');
  }, []);

  /** The phone only shares an approximate location: the gate shows how to turn on the precise one. */
  const recordImprecise = useCallback(() => {
    setFailure(null);
    setState('imprecise');
  }, []);

  /**
   * A new reading that can place the visitor at the door, or `null` once the gate shows why there is none.
   * The first time it shows the browser's permission prompt.
   */
  const read = useCallback(async (): Promise<Position | null> => {
    try {
      const position = await currentPosition();
      if (!mounted.current) return null;
      if (isImprecise(position)) { recordImprecise(); return null; }
      setFailure(null); setState('ready');
      return position;
    } catch (error) {
      if (mounted.current) recordFailure(locationFailure(error));
      return null;
    }
  }, [recordFailure, recordImprecise]);

  const request = useCallback(async () => { await read(); }, [read]);

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

  return { state: required ? state : 'ready', failure, request, read, recordImprecise };
}

/** Steps for the visitor's kind of phone; both while it is unknown (a computer, or before hydration). */
function PlatformSteps({ ios, android }: { ios: ReactNode; android: ReactNode }) {
  const platform = phonePlatform(useBrowserUserAgent());
  return <ol className="location-steps">
    {platform !== 'android' && <li><strong>iPhone:</strong> {ios}</li>}
    {platform !== 'ios' && <li><strong>Android:</strong> {android}</li>}
  </ol>;
}

/** How to allow location again after blocking it, on the visitor's kind of phone. */
function UnblockSteps() {
  return <PlatformSteps
    ios="Ajustes → Privacidad y seguridad → Localización → tu navegador (por ejemplo Safari) → «Al usar la app». Si sigue bloqueada, tocá «aA» en la barra de direcciones → Configuración del sitio web → Ubicación → Permitir."
    android="tocá el ícono junto a la dirección de esta página → Permisos → Ubicación → Permitir. Revisá también que la ubicación del celular esté activada." />;
}

/**
 * How to stop sharing an approximate location, as Apple's and Google's help name the menus: iPhones in Spanish from
 * Spain say «Ajustes» and «Ubicación exacta», in Latin American Spanish «Configuración» and «Ubicación precisa».
 * Chrome for Android asks «Precisa» or «Aproximada» per site, and Android can keep any app approximate.
 */
function PreciseLocationSteps() {
  return <PlatformSteps
    ios="Ajustes (o Configuración) → Privacidad y seguridad → Localización → Sitios web de Safari (o tu navegador) → activá «Ubicación exacta» («Ubicación precisa» en algunos iPhone)."
    android="tocá el ícono junto a la dirección de esta página → Permisos → Ubicación y elegí «Precisa». Si no aparece o sigue aproximada, mantené presionado el ícono de Chrome → Información de la app → Permisos → Ubicación → activá «Usar la ubicación precisa»." />;
}

/** After the server found the visitor away from the door: every ring takes a new reading, so getting closer is enough. */
export function FarFromDoorHelp() {
  return <p className="visitor-location-note">Acercate a la puerta y volvé a tocar: en cada timbrazo medimos tu ubicación de nuevo. Si ya estás ahí, esperá unos segundos a que tu celular se ubique mejor.</p>;
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
    {state === 'imprecise' && <div className="notification-onboarding-help" role="alert"><p>Tu celular está compartiendo una ubicación aproximada, y con eso no podemos confirmar que estés en la puerta. Activá la ubicación precisa y volvé a intentar:</p><PreciseLocationSteps /></div>}
    {state === 'failed' && <p className="notification-onboarding-help" role="alert">{failureDetail(failure)}</p>}
    <button type="button" className="button primary notification-onboarding-primary" disabled={pending} onClick={ask}>{pending ? 'Buscando tu ubicación…' : gateAction(state)}</button>
  </dialog>;
}
