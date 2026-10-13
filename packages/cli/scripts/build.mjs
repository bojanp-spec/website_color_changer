// dist/cli.mjs (Node, bin: cc-export) + dist/cc-core.iife.js (ubacuje se u stranice).
import { build } from 'esbuild';
import { chmodSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url).pathname;
await build({
  entryPoints: [new URL('../src/cli.ts', import.meta.url).pathname],
  outfile: `${dist}cli.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['@playwright/test', 'playwright', 'playwright-core'],
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'warning',
});
chmodSync(`${dist}cli.mjs`, 0o755);
await build({
  entryPoints: [new URL('../../core/src/index.ts', import.meta.url).pathname],
  outfile: `${dist}cc-core.iife.js`,
  bundle: true,
  format: 'iife',
  globalName: 'CC',
  target: 'es2022',
  logLevel: 'warning',
});
console.log('cli: dist/cli.mjs, dist/cc-core.iife.js');
