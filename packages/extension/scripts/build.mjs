// Gradi ekstenziju za Chrome i Firefox (Manifest V3) iz istog koda:
//   dist/chrome/        — za „Load unpacked" (chrome://extensions)
//   dist/firefox/       — za about:debugging → „Load Temporary Add-on"
//   dist/chrome-test/   — kao chrome, ali sa unapred datom dozvolom za sve sajtove (samo za testove)
//   dist/*.zip          — paketi za prodavnice
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist`;
const { version } = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));

const base = {
  manifest_version: 3,
  name: 'Website Color Changer',
  short_name: 'Boje sajta',
  version,
  description: 'Isprobaj drugu paletu boja (60-30-10) na bilo kom sajtu, bez menjanja njegovog koda.',
  icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
  action: { default_title: 'Boje sajta', default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' } },
  permissions: ['activeTab', 'scripting', 'storage'],
  optional_host_permissions: ['<all_urls>'],
  options_ui: { page: 'options.html', open_in_tab: true },
};

const targets = {
  chrome: { ...base, background: { service_worker: 'background.js' }, minimum_chrome_version: '111' },
  firefox: {
    ...base,
    background: { scripts: ['background.js'] },
    browser_specific_settings: {
      gecko: {
        id: 'website-color-changer@local',
        strict_min_version: '140.0',
        // Ekstenzija ne šalje nikakve podatke van browsera.
        data_collection_permissions: { required: ['none'] },
      },
      gecko_android: { strict_min_version: '142.0' },
    },
  },
  'chrome-test': { ...base, background: { service_worker: 'background.js' }, host_permissions: ['<all_urls>'] },
};

rmSync(dist, { recursive: true, force: true });
const outdir = `${dist}/_build`;
await build({
  entryPoints: ['background', 'bridge', 'page', 'options'].map((n) => `${root}src/${n}.ts`),
  outdir,
  bundle: true,
  format: 'iife',
  target: ['chrome111', 'firefox140'],
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});

for (const [name, manifest] of Object.entries(targets)) {
  const dir = `${dist}/${name}`;
  mkdirSync(dir, { recursive: true });
  cpSync(outdir, dir, { recursive: true });
  cpSync(`${root}static`, dir, { recursive: true });
  writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
  if (name !== 'chrome-test') execFileSync('zip', ['-qr', `../website-color-changer-${name}-${version}.zip`, '.'], { cwd: dir });
}
rmSync(outdir, { recursive: true, force: true });
console.log(`extension: dist/chrome, dist/firefox (+ zip) v${version}`);
