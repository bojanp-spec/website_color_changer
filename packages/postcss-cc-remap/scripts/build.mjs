import { build } from 'esbuild';

const common = {
  entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  target: 'node18',
  external: ['postcss'],
  logLevel: 'warning',
};
await build({ ...common, format: 'esm', outfile: new URL('../dist/index.js', import.meta.url).pathname });
await build({ ...common, format: 'cjs', outfile: new URL('../dist/index.cjs', import.meta.url).pathname, footer: { js: 'module.exports = module.exports.default; module.exports.default = module.exports;' } });
console.log('postcss-cc-remap: dist/index.js, dist/index.cjs');
