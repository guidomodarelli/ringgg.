import { DEVICES, DEVICE_PLATFORMS } from '@/constants/devices';
import { LEGACY_DEVICE_NAMES } from '@/constants/homes';
import { cleanName, nameKey, uniqueName } from './names';

/** The number added to a repeated name: "Mi celular 2". */
const COPY_SUFFIX = / \d+$/;
const GENERIC_KEYS = new Set(LEGACY_DEVICE_NAMES.map(nameKey));

/** Shown when a device would keep a name that does not tell it apart from the others. */
export const GENERIC_DEVICE_NAME_MESSAGE = 'Elegí un nombre que lo distinga de los demás, como «iPhone de Ana» o «Compu del living».';

/** Shown when a device would take the name another device of the home already uses. */
export function deviceNameTakenMessage(name: string) {
  return `Ya hay un celular llamado «${name}» en esta casa. Elegí otro nombre.`;
}

/** "iPhone de Guido": the platform in the user agent plus the resident's first name, editable later. */
export function suggestedDeviceName(userAgent: string, residentName: string) {
  const platform = DEVICE_PLATFORMS.find((item) => item.pattern.test(userAgent))?.label ?? DEVICES.defaultName;
  const [firstName] = residentName.trim().split(/\s+/);
  return (firstName ? `${platform} de ${firstName}` : platform).slice(0, DEVICES.nameMaxLength);
}

/** The suggestion for this browser that no other device of the home uses yet: "iPhone de Guido 2". */
export function freeDeviceName(userAgent: string, residentName: string, otherNames: Iterable<string>) {
  return uniqueName(suggestedDeviceName(userAgent, residentName), otherNames, DEVICES.nameMaxLength);
}

/**
 * "Mi celular", "Celular" and their numbered copies say nothing about which device it is: a device
 * never keeps one of them, so nobody has to guess which phone "Mi celular 2" was.
 */
export function isGenericDeviceName(name: string) {
  return GENERIC_KEYS.has(nameKey(name).replace(COPY_SUFFIX, ''));
}

/**
 * Why `name` cannot identify a device of the home, or `''` when it can: it is required, it cannot be
 * generic, and no other device of the home may use it, regardless of case, accents or spaces.
 */
export function deviceNameProblem(name: string, otherNames: Iterable<string>) {
  const clean = cleanName(name);
  if (!clean) return 'Escribí un nombre para este dispositivo.';
  if (isGenericDeviceName(clean)) return GENERIC_DEVICE_NAME_MESSAGE;
  const key = nameKey(clean);
  for (const other of otherNames) if (nameKey(other) === key) return deviceNameTakenMessage(clean);
  return '';
}
