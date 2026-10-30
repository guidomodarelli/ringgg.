export const HOMES = {
  /** The home that existed before several homes: the bootstrap emails of the environment belong to it. */
  originalId: 1,
  maxPerResident: 10,
  nameMaxLength: 50,
  /** Remembers the last home a resident opened, so `/` reopens it. */
  cookieName: 'ringgg-home',
  /** One year. */
  cookieMaxAgeSeconds: 31_536_000,
  /** Query parameter that selects the home in the panel, the poster and notification links. */
  queryParameter: 'home',
};

/** Names residents give themselves in a home: required, unique in that home and short enough for "iPhone de <nombre>". */
export const RESIDENT_NAMES = { maxLength: 40 };

/** Names the original single-home panel gave every device; a resident's first name replaces them. */
export const LEGACY_DEVICE_NAMES = ['Mi celular', 'Celular'];
