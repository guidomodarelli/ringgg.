import { NEARBY_RINGING } from '@/constants/location';
import type { Position } from './geo';

/** Why the browser gave no reading: each caller explains it in its own words. */
export type LocationFailure = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

/** The browser could not say where the device is; `reason` tells which way it failed. */
export class LocationError extends Error {
  constructor(readonly reason: LocationFailure) {
    super(`Browser location failed: ${reason}`);
    this.name = 'LocationError';
  }
}

/** Codes of `GeolocationPositionError`. */
const FAILURES: Record<number, LocationFailure> = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };

/**
 * A new, precise reading of where this device is, never one the browser cached. The browser asks for permission
 * the first time; the reading only travels to the server inside the request that needs it.
 */
export function currentPosition(): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new LocationError('unsupported')); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }); },
      (error) => { reject(new LocationError(FAILURES[error.code] ?? 'unavailable')); },
      { enableHighAccuracy: true, timeout: NEARBY_RINGING.timeoutMs, maximumAge: NEARBY_RINGING.maximumAgeMs },
    );
  });
}

/** The failure of a location request, or `unavailable` for anything else that went wrong. */
export function locationFailure(error: unknown): LocationFailure {
  return error instanceof LocationError ? error.reason : 'unavailable';
}
