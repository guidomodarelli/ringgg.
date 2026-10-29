'use client';
import { useEffect } from 'react';
export function Pwa() {
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => console.error('PWA:serviceWorker registration failed'));
  }, []);
  return null;
}
