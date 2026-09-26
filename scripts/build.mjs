// Bundles the browser engine (IIFE) and the Node CLI (ESM) with esbuild.
import { build } from 'esbuild';
import { chmodSync } from 'node:fs';

await build({
  entryPoints: ['src/engine/index.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  outfile: 'dist/engine.js',
});

await build({
  entryPoints: ['src/cli/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  outfile: 'dist/cli.js',
  banner: { js: '#!/usr/bin/env node' },
});
chmodSync('dist/cli.js', 0o755);
console.log('built dist/engine.js and dist/cli.js');
