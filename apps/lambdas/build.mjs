import { build } from 'esbuild'

const functions = ['poller', 'api', 'tg-webhook', 'pre-signup']

await Promise.all(
  functions.map((fn) =>
    build({
      entryPoints: [`src/${fn}/index.ts`],
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      outfile: `dist/${fn}/index.mjs`,
      sourcemap: false,
      minify: false,
      logLevel: 'info',
      // Some CJS deps call require() at runtime; give them one in the ESM bundle.
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    }),
  ),
)
