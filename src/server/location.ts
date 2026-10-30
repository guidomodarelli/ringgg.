import { z } from 'zod';
import { HTTP } from '@/constants/doorbell';
import { COORDINATE_LIMITS, NEARBY_RINGING } from '@/constants/location';
import { checkNearby, type Position } from '@/lib/geo';
import type { Home } from '@/types/doorbell';
import type { Database } from './database';
import { AppError } from './errors';

/** A reading sent by a browser, within the limits of a real location. */
export const positionSchema = z.object({
  latitude: z.number().min(-COORDINATE_LIMITS.latitudeDegrees).max(COORDINATE_LIMITS.latitudeDegrees),
  longitude: z.number().min(-COORDINATE_LIMITS.longitudeDegrees).max(COORDINATE_LIMITS.longitudeDegrees),
  accuracy: z.number().nonnegative().max(COORDINATE_LIMITS.accuracyMeters),
});

/** Whether visitors must be at the door: only with a saved spot, so the flag never locks a home out. */
export function requiresNearby(home: Pick<Home, 'nearby_only' | 'latitude' | 'longitude'>) {
  return home.nearby_only && home.latitude !== null && home.longitude !== null;
}

/**
 * Lets a ring through only from near the door when the home asks for it. The visitor's reading is
 * compared and dropped: it is never stored. The phone reports it, so this stops casual remote rings,
 * not someone who fakes their location.
 */
export function requireNearby(home: Home, position: Position | null | undefined) {
  if (!requiresNearby(home) || home.latitude === null || home.longitude === null) return;
  if (!position) throw new AppError(HTTP.conflict, 'LOCATION_REQUIRED', `«${home.name}» solo recibe timbrazos desde la puerta. Permití la ubicación para tocar.`);
  const check = checkNearby({ latitude: home.latitude, longitude: home.longitude }, position);
  if (check === 'imprecise') throw new AppError(HTTP.conflict, 'LOCATION_IMPRECISE', 'No pudimos confirmar que estés en la puerta: la ubicación de tu celular no es precisa. Activá la ubicación precisa y volvé a intentar.');
  if (check === 'far') throw new AppError(HTTP.conflict, 'TOO_FAR', `Parece que no estás en la puerta de «${home.name}». Acercate para tocar el timbre.`);
}

/**
 * Saves where the door is from a resident's reading there. Only its coordinates are kept, so the reading
 * must be precise: its error would otherwise be added to every visitor's comparison.
 */
export async function setHomeLocation(database: Database, homeId: number, position: Position) {
  if (position.accuracy > NEARBY_RINGING.doorMaxAccuracyMeters) throw new AppError(HTTP.badRequest, 'LOCATION_IMPRECISE', `La ubicación de tu celular no es lo bastante precisa (±${Math.round(position.accuracy)} m; hace falta ±${NEARBY_RINGING.doorMaxAccuracyMeters} m o menos). Probá al aire libre, frente a la puerta, o activá la ubicación precisa.`);
  await database.query('UPDATE homes SET latitude = $2, longitude = $3 WHERE id = $1', [homeId, position.latitude, position.longitude]);
}

/** Forgets the door's spot; ringing from anywhere comes back with it, since there is nothing to compare. */
export async function clearHomeLocation(database: Database, homeId: number) {
  await database.query('UPDATE homes SET latitude = NULL, longitude = NULL, nearby_only = FALSE WHERE id = $1', [homeId]);
}

/** Turns the requirement on or off; turning it on needs a saved spot, checked in the same statement. */
export async function setNearbyOnly(database: Database, homeId: number, enabled: boolean) {
  const updated = await database.query(
    'UPDATE homes SET nearby_only = $2 WHERE id = $1 AND (NOT $2 OR (latitude IS NOT NULL AND longitude IS NOT NULL)) RETURNING id',
    [homeId, enabled],
  );
  if (!updated.rows.length) throw new AppError(HTTP.conflict, 'LOCATION_MISSING', 'Primero guardá la ubicación de la casa, parado en la puerta.');
}
