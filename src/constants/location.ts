/** Ringing only from near the door: how close counts and how precise a reading must be. */
export const NEARBY_RINGING = {
  /** Distance from the saved spot within which a visitor counts as being at the door. */
  radiusMeters: 150,
  /** A reading less precise than this cannot tell whether someone is at the door. */
  maxAccuracyMeters: 300,
  /** How long the browser may look for a precise reading before giving up. */
  timeoutMs: 15_000,
  /** A reading this recent is still where the person is now. */
  maximumAgeMs: 60_000,
};

/** What a browser may report: anything outside these is not a location on Earth. */
export const COORDINATE_LIMITS = {
  latitudeDegrees: 90,
  longitudeDegrees: 180,
  /** A reading off by more than this is no location at all. */
  accuracyMeters: 100_000,
};
