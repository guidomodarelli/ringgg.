import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { APP } from '@/constants/doorbell';
import { STARTUP_ICON_WIDTH_SHARE, STARTUP_SCREENS } from '@/constants/startup-images';
import { startupImageSize } from '@/lib/startup-images';

/** Built once per screen size at build time; any other size is a 404. */
export const dynamicParams = false;
export function generateStaticParams() {
  return STARTUP_SCREENS.map((screen) => ({ size: startupImageSize(screen) }));
}

/** The launch image iOS shows while the installed app opens: the app icon on the app background. */
export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const [width, height] = size.split('x').map(Number);
  const icon = await readFile(join(/* turbopackIgnore: true */ process.cwd(), 'public/icons/icon-512.png'));
  const iconWidth = Math.round(width * STARTUP_ICON_WIDTH_SHARE);
  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: APP.background }}>
      <div style={{ width: iconWidth, height: iconWidth, backgroundImage: `url(data:image/png;base64,${icon.toString('base64')})`, backgroundSize: '100% 100%' }} />
    </div>,
    { width, height },
  );
}
