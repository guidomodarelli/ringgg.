'use client';
import { freeDeviceName } from '@/lib/device-name';
import { useBrowserUserAgent } from '../use-browser-user-agent';

/**
 * Prefill for the name of this device: «iPhone de Guido», with a number when another device of the
 * home already uses it. The browser is read after hydration, so the server and client renders agree.
 */
export function useDeviceNameSuggestion(residentName: string, otherNames: string[]) {
  return freeDeviceName(useBrowserUserAgent(), residentName, otherNames);
}
