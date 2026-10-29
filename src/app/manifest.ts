import type { MetadataRoute } from 'next';
import { APP } from '@/constants/doorbell';
export default function manifest(): MetadataRoute.Manifest {
  return { id: '/', name: 'ringgg. · Tu timbre digital', short_name: APP.name, description: 'Tu casa, a un toque.', start_url: '/', scope: '/', display: 'standalone', background_color: APP.background, theme_color: APP.theme, lang: 'es-AR', icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ] };
}
