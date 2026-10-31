import { NEARBY_RINGING } from '@/constants/location';

export interface Coordinates { latitude: number; longitude: number }
/** A reading from the device: where it is and how many meters it may be off. */
export interface Position extends Coordinates { accuracy: number }
/** Whether a reading shows someone at the door, away from it, or too imprecise to tell. */
export type NearbyCheck = 'near' | 'far' | 'imprecise';

const EARTH_RADIUS_METERS = 6_371_000;
const HALF_TURN_DEGREES = 180;

function radians(degrees: number) {
  return degrees * Math.PI / HALF_TURN_DEGREES;
}

/** Great-circle distance in meters (haversine): exact enough for a few hundred meters around a door. */
export function distanceMeters(from: Coordinates, to: Coordinates) {
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const halfChord = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(halfChord));
}

/** Whether a reading is too vague to tell if someone is at the door; the visitor's page checks it before ringing. */
export function isImprecise(position: Pick<Position, 'accuracy'>, rules = NEARBY_RINGING) {
  return position.accuracy > rules.maxAccuracyMeters;
}

/**
 * Near when the reading could be within the radius once its own error is counted: a phone indoors is
 * often off by tens of meters. A reading less precise than the limit cannot decide either way.
 */
export function checkNearby(door: Coordinates, position: Position, rules = NEARBY_RINGING): NearbyCheck {
  if (isImprecise(position, rules)) return 'imprecise';
  return distanceMeters(door, position) <= rules.radiusMeters + position.accuracy ? 'near' : 'far';
}
