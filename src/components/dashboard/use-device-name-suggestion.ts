'use client';
import { useSyncExternalStore } from 'react';
import { freeDeviceName } from '@/lib/device-name';

function ignoreChanges() {
  // The user agent does not change while the page is open: there is nothing to listen to.
}

function subscribeToNothing() {
  return ignoreChanges;
}

function browserUserAgent() {
  return navigator.userAgent;
}

/** The server render does not know the browser: it suggests from the resident's name alone. */
function serverUserAgent() {
  return '';
}

/**
 * Prefill for the name of this device: «iPhone de Guido», with a number when another device of the
 * home already uses it. The browser is read after hydration, so the server and client renders agree.
 */
export function useDeviceNameSuggestion(residentName: string, otherNames: string[]) {
  const userAgent = useSyncExternalStore(subscribeToNothing, browserUserAgent, serverUserAgent);
  return freeDeviceName(userAgent, residentName, otherNames);
}
