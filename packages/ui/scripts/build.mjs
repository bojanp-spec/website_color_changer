// Gradi panel kao jedan samostalan fajl (core je uključen):
//   dist/cc-panel.js        — čitljiv, za <script data-cc-snippet> i testove
//   dist/cc-panel.min.js    — minifikovan
//   dist/bookmarklet.txt    — javascript: URL (ceo kod u linku, radi bez hostinga)
//   dist/install.html       — stranica sa linkom za prevlačenje u bookmarks bar
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
mkdirSync(dist, { recursive: true });
const entry = new URL('../src/index.ts', import.meta.url).pathname;
const common = { entryPoints: [entry], bundle: true, format: 'iife', globalName: 'CCPanel', target: 'es2022', logLevel: 'warning' };

await build({ ...common, outfile: new URL('cc-panel.js', dist).pathname, sourcemap: true });
await build({ ...common, outfile: new URL('cc-panel.min.js', dist).pathname, minify: true, legalComments: 'none' });

const min = readFileSync(new URL('cc-panel.min.js', dist), 'utf8').trim();
const bookmarklet = `javascript:${encodeURIComponent(`(()=>{${min}})();void 0`)}`;
writeFileSync(new URL('bookmarklet.txt', dist), bookmarklet);

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
writeFileSync(
  new URL('install.html', dist),
  `<!doctype html>
<html lang="sr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Website Color Changer — bookmarklet</title>
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
  <p>Prevuci dugme ispod u traku sa obeleživačima (bookmarks bar):</p>
  <p><a class="bm" href="${escapeAttr(bookmarklet)}">🎨 Boje sajta</a></p>
  <ol>
    <li>Otvori bilo koji sajt.</li>
    <li>Klikni obeleživač „🎨 Boje sajta" — pojaviće se panel u donjem desnom uglu.</li>
    <li>Izaberi gotovu paletu ili tri svoje boje (60 / 30 / 10). <kbd>Alt+C</kbd> prebacuje original ↔ nova paleta.</li>
    <li>„Preuzmi .css" daje fajl za trajnu primenu; „Kopiraj link" čuva paletu u linku.</li>
  </ol>
  <p class="muted"><small>Ceo alat je u samom linku (${Math.round(bookmarklet.length / 1024)} KB) — ništa se ne učitava sa interneta.
  Sajt se ne menja trajno: zatvaranje panela (×) ili osvežavanje stranice vraća original.
  Na sajtovima sa strogom Content-Security-Policy browser može da blokira bookmarklet — tada koristi ekstenziju (M6).</small></p>
</main>
</body>
</html>
`,
);
console.log(`ui: cc-panel.min.js ${Math.round(min.length / 1024)} KB, bookmarklet ${Math.round(bookmarklet.length / 1024)} KB`);
