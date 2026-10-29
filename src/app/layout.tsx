import type { Metadata, Viewport } from 'next';
import { Pwa } from '@/components/pwa';
import './globals.css';

export const metadata: Metadata = {
  title: 'ringgg. · Tu casa, a un toque',
  description: 'Tu timbre digital. Un QR en la puerta, un aviso en tu celular.',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'ringgg' },
  icons: { apple: '/icons/icon-192.png', icon: '/icons/icon-192.png' },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f8f7f3' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es-AR"><body><Pwa />{children}</body></html>;
}
