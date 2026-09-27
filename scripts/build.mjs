// Bundles the browser engine (IIFE) and the Node CLI (ESM) with esbuild.
import { build } from 'esbuild';
import { chmodSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// `import x from './file.md?raw'` → the file's text (vitest does the same natively).
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, a => ({ path: resolve(dirname(a.importer), a.path.slice(0, -4)), namespace: 'raw' }));
    b.onLoad({ filter: /.*/, namespace: 'raw' }, a => ({ contents: readFileSync(a.path, 'utf8'), loader: 'text' }));
  },
};

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
  plugins: [raw],
});
chmodSync('dist/cli.js', 0o755);
console.log('built dist/engine.js and dist/cli.js');
