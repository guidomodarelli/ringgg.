import { createEslintConfig } from '@golfo/lint/eslint';

/**
 * Generated output, local data, test artifacts and agent files, which nobody edits by hand. `neon.ts` is
 * the Neon CLI configuration that `neon init` writes.
 */
const IGNORED_PATHS = ['.next/**', 'next-env.d.ts', 'public/sw.js', '.data/**', 'test-results/**', 'playwright-report/**', '.agents/**', '.golfo/**', '.codex/**', 'neon.ts'];

// `npm run lint` runs `golfo-lint lint`, which runs this config with `bun lint`.
export default [
  ...createEslintConfig({ tsconfigRootDir: import.meta.dirname, linter: 'bun', react: true, next: true, vitest: true }),
  { ignores: IGNORED_PATHS },
];
