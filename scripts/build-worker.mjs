// Bundles the edge Worker (Durable Objects + shared simulation) into a single
// ES module for `wrangler deploy` or a direct API upload.
import { build } from 'esbuild';

await build({
  entryPoints: ['worker/index.js'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  outfile: 'dist-worker/index.js',
  external: ['cloudflare:workers'],
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
});
