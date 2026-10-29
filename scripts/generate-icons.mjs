import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
await mkdir('public/icons', { recursive: true });
await Promise.all([192, 512].map((size) => sharp('public/icon.svg').resize(size, size).png().toFile(`public/icons/icon-${size}.png`)));
await sharp('public/icon.svg').png().toFile('public/icons/maskable-512.png');
