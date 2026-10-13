// Builds the panel as a single self-contained file (core included), in Serbian and English:
//   dist/cc-panel.js, dist/cc-panel_en.js          — readable, for <script data-cc-snippet> and tests
//   dist/cc-panel.min.js, dist/cc-panel_en.min.js  — minified
//   dist/bookmarklet.txt, dist/bookmarklet_en.txt  — javascript: URL (all code in the link, works without hosting)
//   dist/install.html, dist/install_en.html        — page with a link to drag to the bookmarks bar
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
mkdirSync(dist, { recursive: true });
const entry = new URL('../src/index.ts', import.meta.url).pathname;

const TEXT = {
  sr: {
    title: 'Website Color Changer — bookmarklet',
    drag: 'Prevuci dugme ispod u traku sa obeleživačima (bookmarks bar):',
    button: '🎨 Boje sajta',
    steps: [
      'Otvori bilo koji sajt.',
      'Klikni obeleživač „🎨 Boje sajta" — pojaviće se panel u donjem desnom uglu.',
      'Izaberi gotovu paletu ili tri svoje boje (60 / 30 / 10). <kbd>Alt+C</kbd> prebacuje original ↔ nova paleta.',
      '„Preuzmi .css" daje fajl za trajnu primenu; „Kopiraj link" čuva paletu u linku.',
    ],
    note: (kb) =>
      `Ceo alat je u samom linku (${kb} KB) — ništa se ne učitava sa interneta.
  Sajt se ne menja trajno: zatvaranje panela (×) ili osvežavanje stranice vraća original.
  Na sajtovima sa strogom Content-Security-Policy browser može da blokira bookmarklet — tada koristi ekstenziju.`,
  },
  en: {
    title: 'Website Color Changer — bookmarklet',
    drag: 'Drag the button below to your bookmarks bar:',
    button: '🎨 Site colors',
    steps: [
      'Open any website.',
      'Click the “🎨 Site colors” bookmark — a panel appears in the bottom-right corner.',
      'Pick a ready-made palette or your own three colors (60 / 30 / 10). <kbd>Alt+C</kbd> switches between the original and the new palette.',
      '“Download .css” gives you a file for permanent use; “Copy link” stores the palette in a link.',
    ],
    note: (kb) =>
      `The whole tool is inside the link (${kb} KB) — nothing is loaded from the internet.
  The site is not changed permanently: closing the panel (×) or reloading the page restores the original.
  On sites with a strict Content-Security-Policy the browser may block the bookmarklet — use the extension instead.`,
  },
};

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

for (const lang of ['sr', 'en']) {
  const suffix = lang === 'en' ? '_en' : '';
  const common = {
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    globalName: 'CCPanel',
    target: 'es2022',
    logLevel: 'warning',
    define: { __CC_LANG__: JSON.stringify(lang) },
  };
  await build({ ...common, outfile: new URL(`cc-panel${suffix}.js`, dist).pathname, sourcemap: true });
  await build({ ...common, outfile: new URL(`cc-panel${suffix}.min.js`, dist).pathname, minify: true, legalComments: 'none' });

  const min = readFileSync(new URL(`cc-panel${suffix}.min.js`, dist), 'utf8').trim();
  const bookmarklet = `javascript:${encodeURIComponent(`(()=>{${min}})();void 0`)}`;
  writeFileSync(new URL(`bookmarklet${suffix}.txt`, dist), bookmarklet);

  const t = TEXT[lang];
  writeFileSync(
    new URL(`install${suffix}.html`, dist),
    `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.title}</title>
<style>
  :root { color-scheme: light dark; --fg: #1d1d1f; --bg: #fafafa; --muted: #6b6b70; --accent: #d32f2f; }
  @media (prefers-color-scheme: dark) { :root { --fg: #f2f2f4; --bg: #161618; --muted: #a0a0a8; --accent: #ff6b6b; } }
  body { margin: 0; padding: 48px 16px; font: 16px/1.6 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
  main { max-width: 640px; margin: 0 auto; }
  a.bm { display: inline-block; padding: 12px 20px; border-radius: 10px; background: var(--accent); color: #fff; font-weight: 600; text-decoration: none; }
  li { margin: 6px 0; }
  small, .muted { color: var(--muted); }
  code { font: 14px ui-monospace, monospace; }
</style>
</head>
<body>
<main>
  <h1>🎨 Website Color Changer</h1>
  <p>${t.drag}</p>
  <p><a class="bm" href="${escapeAttr(bookmarklet)}">${t.button}</a></p>
  <ol>
    ${t.steps.map((s) => `<li>${s}</li>`).join('\n    ')}
  </ol>
  <p class="muted"><small>${t.note(Math.round(bookmarklet.length / 1024))}</small></p>
</main>
</body>
</html>
`,
  );
  console.log(`ui[${lang}]: cc-panel${suffix}.min.js ${Math.round(min.length / 1024)} KB, bookmarklet ${Math.round(bookmarklet.length / 1024)} KB`);
}
