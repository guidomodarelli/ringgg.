import { describe, expect, test } from 'vitest';
import { checkNearby, distanceMeters } from '../src/lib/geo';
import { NEARBY_RINGING } from '../src/constants/location';

const DOOR = { latitude: -34.6037, longitude: -58.3816 };
/** About 50 m north of the door: one degree of latitude is roughly 111 km. */
const NEXT_DOOR = { latitude: DOOR.latitude + 0.00045, longitude: DOOR.longitude };
/** About 1.1 km north. */
const ACROSS_TOWN = { latitude: DOOR.latitude + 0.01, longitude: DOOR.longitude };

describe('distancia a la puerta', () => {
  test('mide en metros sobre la superficie de la Tierra', () => {
    expect(distanceMeters(DOOR, DOOR)).toBe(0);
    expect(distanceMeters(DOOR, NEXT_DOOR)).toBeCloseTo(50, -1);
    expect(distanceMeters(DOOR, ACROSS_TOWN)).toBeCloseTo(1112, -1);
    expect(distanceMeters(DOOR, ACROSS_TOWN)).toBeCloseTo(distanceMeters(ACROSS_TOWN, DOOR), 6);
  });

  test('cerca, lejos o imprecisa según el radio y la precisión del celular', () => {
    expect(checkNearby(DOOR, { ...NEXT_DOOR, accuracy: 10 })).toBe('near');
    expect(checkNearby(DOOR, { ...ACROSS_TOWN, accuracy: 10 })).toBe('far');
    // A reading's own error counts in its favor, up to the limit where it stops meaning anything.
    const justOutside = { latitude: DOOR.latitude + 0.0018, longitude: DOOR.longitude, accuracy: 60 };
    expect(distanceMeters(DOOR, justOutside)).toBeGreaterThan(NEARBY_RINGING.radiusMeters);
    expect(checkNearby(DOOR, justOutside)).toBe('near');
    expect(checkNearby(DOOR, { ...NEXT_DOOR, accuracy: NEARBY_RINGING.maxAccuracyMeters + 1 })).toBe('imprecise');
  });
});
