import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

/** Square PNG sizes, in pixels, that `src/app/manifest.ts` and the layout reference as `icon-<size>.png`. */
const ICON_SIZES_PX = { standard: 192, large: 512 };

await mkdir('public/icons', { recursive: true });
await Promise.all(Object.values(ICON_SIZES_PX).map((size) => sharp('public/icon.svg').resize(size, size).png().toFile(`public/icons/icon-${size}.png`)));
await sharp('public/icon.svg').png().toFile('public/icons/maskable-512.png');
