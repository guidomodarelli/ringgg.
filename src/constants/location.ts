/** Ringing only from near the door: how close counts and how precise a reading must be. */
export const NEARBY_RINGING = {
  /** Distance from the saved spot within which a visitor counts as being at the door. */
  radiusMeters: 150,
  /** A reading less precise than this cannot tell whether someone is at the door. */
  maxAccuracyMeters: 300,
  /**
   * The door's spot is saved once and its error is never stored, so every visitor is compared against
   * it as if it were exact: a vague door reading would turn away visitors standing at the real door.
   */
  doorMaxAccuracyMeters: 50,
  /** How long the browser may look for a precise reading before giving up. */
  timeoutMs: 15_000,
  /**
   * No cached reading: one from a minute ago may have been taken down the street, or before the visitor turned on
   * the precise location, and retrying would only get that same reading back.
   */
  maximumAgeMs: 0,
};

/** What a browser may report: anything outside these is not a location on Earth. */
export const COORDINATE_LIMITS = {
  latitudeDegrees: 90,
  longitudeDegrees: 180,
  /** A reading off by more than this is no location at all. */
  accuracyMeters: 100_000,
};
