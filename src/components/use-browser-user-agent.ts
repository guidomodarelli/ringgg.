'use client';
import { useSyncExternalStore } from 'react';

function ignoreChanges() {
  // The user agent does not change while the page is open: there is nothing to listen to.
}

function subscribeToNothing() {
  return ignoreChanges;
}

function browserUserAgent() {
  return navigator.userAgent;
}

/** The server render does not know the browser. */
function serverUserAgent() {
  return '';
}

/** This browser's user agent, read after hydration so the server and client renders agree (`''` on the server). */
export function useBrowserUserAgent() {
  return useSyncExternalStore(subscribeToNothing, browserUserAgent, serverUserAgent);
}

/** Phone family for platform-specific steps: iPhone and iPad share iOS settings. */
export function phonePlatform(userAgent: string): 'ios' | 'android' | 'other' {
  if (/iPhone|iPad/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'other';
}
