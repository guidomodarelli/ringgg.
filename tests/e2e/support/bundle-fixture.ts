import { build, type Plugin } from 'esbuild';
import { resolve } from 'node:path';

/** Stand-ins for what only exists inside a running Next.js app: the App Router hooks and the dashboard's auth client. */
const STUBS_PATH = resolve('tests/fixtures/dashboard-stubs.ts');

/**
 * `next/image` is CommonJS that exports its component as `default`. This package is an ES module, so esbuild
 * follows Node's interop and gives a default import the whole `module.exports`; Next's own bundler reads
 * `default` instead. The real component is re-exported as `module.exports` so both read the same thing.
 */
const NEXT_IMAGE_INTEROP: Plugin = {
  name: 'next-image-interop',
  setup(builder) {
    builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'next/image', namespace: 'next-image-interop' }));
    builder.onLoad({ filter: /.*/, namespace: 'next-image-interop' }, () => ({ contents: "module.exports = require('next/dist/shared/lib/image-external').default;", resolveDir: process.cwd(), loader: 'js' }));
  },
};

interface FixtureBundleOptions {
  /** React's development build, which the `Profiler` of the dashboard fixture needs to count commits. */
  development?: boolean;
  /** Also replaces `@/lib/auth-client`, for fixtures that render the whole dashboard. */
  stubAuthClient?: boolean;
}

/**
 * Bundles a component fixture for the browser. Fixtures render outside a Next.js app, so the bundle gets
 * what Next's own build provides: its build-time flags (`process.env.*`, all unset here) and a stand-in for
 * `next/navigation`, whose hooks need a mounted App Router.
 */
export async function bundleFixture(entry: string, { development = false, stubAuthClient = false }: FixtureBundleOptions = {}) {
  const stubbedModules = stubAuthClient ? /^(?:next\/navigation|@\/lib\/auth-client)$/ : /^next\/navigation$/;
  const stubs: Plugin = { name: 'next-app-stubs', setup(builder) { builder.onResolve({ filter: stubbedModules }, () => ({ path: STUBS_PATH })); } };
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, platform: 'browser', jsx: 'automatic', plugins: [stubs, NEXT_IMAGE_INTEROP],
    define: { 'process.env.NODE_ENV': development ? '"development"' : '"production"', 'process.env': '{}' },
  });
  return result.outputFiles[0].text;
}
