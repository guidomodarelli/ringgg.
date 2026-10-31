import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Neon's SDK imports `next/headers` without an extension, which only a bundler resolves: Vite handles it, as Next does.
  test: { include: ['tests/*.test.ts'], environment: 'node', server: { deps: { inline: ['@neondatabase/auth'] } } },
});
