import { DEVICES, DEVICE_PLATFORMS } from '@/constants/devices';

/** "iPhone de Guido": the platform in the user agent plus the resident's first name, editable later. */
export function suggestedDeviceName(userAgent: string, residentName: string) {
  const platform = DEVICE_PLATFORMS.find((item) => item.pattern.test(userAgent))?.label ?? DEVICES.defaultName;
  const [firstName] = residentName.trim().split(/\s+/);
  return (firstName ? `${platform} de ${firstName}` : platform).slice(0, DEVICES.nameMaxLength);
}
