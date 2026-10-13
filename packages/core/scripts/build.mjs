// IIFE bundle za ubacivanje u stranicu (Playwright, bookmarklet): window.CC = { scanDocument, ... }
import { build } from 'esbuild';

await build({
  entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  outfile: new URL('../dist/cc-core.iife.js', import.meta.url).pathname,
  bundle: true,
  format: 'iife',
  globalName: 'CC',
  target: 'es2022',
  minify: process.argv.includes('--minify'),
  sourcemap: !process.argv.includes('--minify'),
  logLevel: 'info',
});
