/** The name as typed, without surrounding or repeated spaces; casing and accents are kept. */
export function cleanName(name: string) {
  return name.trim().replace(/\s+/g, ' ');
}

/**
 * Comparable form of a name: case, accents and repeated spaces do not make two names different, so
 * "Guido", "guido" and "Guídó" are the same resident for uniqueness checks.
 */
export function nameKey(name: string) {
  return cleanName(name).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * The first free variant of `base` among `taken` names: "iPhone de Guido", then "iPhone de Guido 2"...
 * The suffix always fits: the base is shortened when needed, never the number.
 */
export function uniqueName(base: string, taken: Iterable<string>, maxLength: number) {
  const takenKeys = new Set([...taken].map(nameKey));
  const clean = cleanName(base).slice(0, maxLength);
  if (!takenKeys.has(nameKey(clean))) return clean;
  for (let copy = 2; ; copy += 1) {
    const suffix = ` ${copy}`;
    const candidate = `${clean.slice(0, maxLength - suffix.length).trimEnd()}${suffix}`;
    if (!takenKeys.has(nameKey(candidate))) return candidate;
  }
}
