// Gradi ekstenziju za Chrome i Firefox (Manifest V3) iz istog koda, na srpskom i engleskom:
//   dist/chrome/, dist/chrome_en/            — za „Load unpacked" (chrome://extensions)
//   dist/firefox/, dist/firefox_en/          — za about:debugging → „Load Temporary Add-on"
//   dist/chrome-test/, dist/chrome-test_en/  — kao chrome, ali sa unapred datom dozvolom za sve sajtove (samo za testove)
//   dist/*.zip                               — paketi (engleski imaju sufiks _en)
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist`;
const { version } = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));

const LOCALE = {
  sr: {
    name: 'Boje sajta (Website Color Changer)',
    short_name: 'Boje sajta',
    description: 'Isprobaj drugu paletu boja (60-30-10) na bilo kom sajtu, bez menjanja njegovog koda.',
    title: 'Boje sajta',
    geckoId: 'website-color-changer@local',
  },
  en: {
    name: 'Website Color Changer',
    short_name: 'Site colors',
    description: "Try a different color palette (60-30-10) on any website without changing the site's code.",
    title: 'Site colors',
    geckoId: 'website-color-changer-en@local',
  },
};

function targetsFor(lang) {
  const l = LOCALE[lang];
  const base = {
    manifest_version: 3,
    name: l.name,
    short_name: l.short_name,
    version,
    description: l.description,
    icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
    action: { default_title: l.title, default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' } },
    permissions: ['activeTab', 'scripting', 'storage'],
    optional_host_permissions: ['<all_urls>'],
    options_ui: { page: 'options.html', open_in_tab: true },
  };
  return {
    chrome: { ...base, background: { service_worker: 'background.js' }, minimum_chrome_version: '111' },
    firefox: {
      ...base,
      background: { scripts: ['background.js'] },
      browser_specific_settings: {
        gecko: {
          id: l.geckoId,
          strict_min_version: '140.0',
          // Ekstenzija ne šalje nikakve podatke van browsera.
          data_collection_permissions: { required: ['none'] },
        },
        gecko_android: { strict_min_version: '142.0' },
      },
    },
    'chrome-test': { ...base, background: { service_worker: 'background.js' }, host_permissions: ['<all_urls>'] },
  };
}

rmSync(dist, { recursive: true, force: true });
for (const lang of ['sr', 'en']) {
  const suffix = lang === 'en' ? '_en' : '';
  const outdir = `${dist}/_build${suffix}`;
  await build({
    entryPoints: ['background', 'bridge', 'page', 'options'].map((n) => `${root}src/${n}.ts`),
    outdir,
    bundle: true,
    format: 'iife',
    target: ['chrome111', 'firefox140'],
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
    define: { __CC_LANG__: JSON.stringify(lang) },
  });

  for (const [name, manifest] of Object.entries(targetsFor(lang))) {
    const dir = `${dist}/${name}${suffix}`;
    mkdirSync(dir, { recursive: true });
    cpSync(outdir, dir, { recursive: true });
    cpSync(`${root}static`, dir, { recursive: true });
    writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
    if (name !== 'chrome-test') {
      execFileSync('zip', ['-qr', `../website-color-changer-${name}-${version}${suffix}.zip`, '.'], { cwd: dir });
    }
  }
  rmSync(outdir, { recursive: true, force: true });
}
console.log(`extension: dist/{chrome,firefox}{,_en} (+ zip) v${version}`);
