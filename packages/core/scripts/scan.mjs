#!/usr/bin/env node
// Scans a site's color palette in headless Chromium and prints it to the terminal.
//
//   npm run scan -- https://example.com [--json out.json] [--width 1440] [--no-scroll] [--dark]
//                   [--palette red-gray | --palette "#FAFAFA,#4B4B4F,#D32F2F"] [--all] [--lang en|sr]
//
// --palette: classifies colors (60-30-10) and shows the old → new color map for the chosen palette.
// --all: also show colors that don't change in the map.
// --screenshot <dir>: full-page screenshots before and after applying the palette (original.png, <palette>.png).
// --css <file>: export the CSS layer for permanent use (with --palette).
// --lang en|sr: output language (default: CC_LANG, then the system language; `sr*` → Serbian, else English).
//
// Running locally requires Chromium for Playwright: `npx playwright install chromium`.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a) || a.startsWith('file:'));
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const lang = (opt('--lang') || process.env.CC_LANG || process.env.LC_ALL || process.env.LANG || '').toLowerCase().startsWith('sr') ? 'sr' : 'en';
const M = {
  sr: {
    usage: 'Upotreba: npm run scan -- <url> [--json out.json] [--width 1440] [--no-scroll] [--dark] [--palette <preset | "#dom,#sek,#akc">] [--lang en|sr]',
    palette: 'Paleta:',
    site: 'sajt:',
    applied: (rules, patched) => `Primenjeno: ${rules} CSS pravila, ${patched} elemenata sa izmenjenim atributima`,
    fallback: (n) => `, ${n} preko izračunatog stila`,
    variable: (name) => `varijabla ${name}`,
    inline: (n) => `inline na ${n} elemenata`,
    local: (fg, bg, to, via) => `lokalni kontrast: ${fg} na ${bg} → ${to} (${via})`,
  },
  en: {
    usage: 'Usage: npm run scan -- <url> [--json out.json] [--width 1440] [--no-scroll] [--dark] [--palette <preset | "#dom,#sec,#acc">] [--lang en|sr]',
    palette: 'Palette:',
    site: 'site:',
    applied: (rules, patched) => `Applied: ${rules} CSS rules, ${patched} elements with modified attributes`,
    fallback: (n) => `, ${n} via computed fallback`,
    variable: (name) => `variable ${name}`,
    inline: (n) => `inline on ${n} elements`,
    local: (fg, bg, to, via) => `local contrast: ${fg} on ${bg} → ${to} (${via})`,
  },
}[lang];
if (!url) {
  console.error(M.usage);
  process.exit(1);
}

const width = Number(opt('--width') ?? 1440);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    colorScheme: args.includes('--dark') ? 'dark' : 'light',
  });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });

  if (!args.includes('--no-scroll')) {
    // Lazy-loaded content: scroll to the bottom, then back to the top.
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * 0.8) {
        scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      scrollTo(0, 0);
    });
    await page.waitForLoadState('networkidle').catch(() => {});
  }

  await page.addScriptTag({ path: fileURLToPath(new URL('../dist/cc-core.iife.js', import.meta.url)) });
  const { text, json, mapText, error } = await page.evaluate(
    async ({ palette, all, lang, head: label }) => {
      const CC = window.CC;
      const result = await CC.scanDocument(document);
      const swatch = (hex) => {
        const n = parseInt(hex.slice(1, 7), 16);
        return `\x1b[48;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m      \x1b[0m `;
      };
      const usages = result.usages.map(({ element, ...u }) => (element ? { ...u, element: element.localName } : u));
      const { pairElements: _p, scopes: _s, ...plain } = result;
      const json = { url: location.href, ...plain, usages };
      if (!palette) return { text: CC.formatPalette(result, swatch, lang), json };

      let chosen = CC.findPreset(palette);
      if (!chosen) {
        const [dominant, secondary, accent] = palette.split(',').map((x) => x.trim());
        chosen = { dominant, secondary, accent };
      }
      try {
        const c = CC.classify(result, { lang });
        const m = CC.buildColorMap(c, chosen, result.pairs, { lang });
        json.classification = { bases: c.bases, altBases: c.altBases, roles: [...c.roles.values()] };
        json.colorMap = m.entries;
        const shown = all ? m : { ...m, entries: m.entries.filter((e) => e.role !== 'protected') };
        const head = `${label.palette} ${chosen.dominant} / ${chosen.secondary} / ${chosen.accent}` +
          `   (${label.site} ${c.bases.dominant} / ${c.bases.secondary} / ${c.bases.accent ?? '—'})`;
        return { text: CC.formatPalette(result, swatch, lang), json, mapText: `${head}\n${CC.formatColorMap(shown, swatch, lang)}` };
      } catch (e) {
        return { text: CC.formatPalette(result, swatch, lang), json, error: String(e?.message ?? e) };
      }
    },
    { palette: opt('--palette'), all: args.includes('--all'), lang, head: { palette: M.palette, site: M.site } },
  );

  console.log(`\n🎨 ${url}  (viewport ${width}px)\n`);
  console.log(text);
  if (mapText) console.log(`\n🔁 ${mapText}`);
  if (error) {
    console.error(`\n✖ ${error}`);
    process.exitCode = 1;
  }
  const shotDir = opt('--screenshot');
  const cssOut = opt('--css');
  if ((shotDir || cssOut) && opt('--palette') && !error) {
    if (shotDir) {
      mkdirSync(shotDir, { recursive: true });
      await page.screenshot({ path: join(shotDir, 'original.png'), fullPage: true });
    }
    const report = await page.evaluate(async ({ palette, lang }) => {
      const CC = window.CC;
      let chosen = CC.findPreset(palette);
      if (!chosen) {
        const [dominant, secondary, accent] = palette.split(',').map((x) => x.trim());
        chosen = { dominant, secondary, accent };
      }
      const engine = CC.createEngine(document, { lang });
      await engine.analyze();
      const r = engine.apply(chosen);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      return { css: engine.exportCss(), rules: r.rules, patched: r.patchedElements, fixes: r.localContrastFixes, fallback: r.fallbackPatched };
    }, { palette: opt('--palette'), lang });
    console.log(`\n🎨 ${M.applied(report.rules, report.patched)}${report.fallback ? M.fallback(report.fallback) : ''}`);
    for (const f of report.fixes) {
      const via = f.via.kind === 'variable' ? M.variable(f.via.name) : M.inline(f.via.elements);
      console.log(`   ⚖ ${M.local(f.fg, f.bg, f.to, via)}`);
    }
    if (shotDir) {
      const name = opt('--palette').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');
      await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: true });
      console.log(`📸 ${join(shotDir, 'original.png')}  →  ${join(shotDir, `${name}.png`)}`);
    }
    if (cssOut) {
      writeFileSync(cssOut, report.css);
      console.log(`CSS: ${cssOut}`);
    }
  }

  const out = opt('--json');
  if (out) {
    writeFileSync(out, JSON.stringify(json, null, 2));
    console.log(`\nJSON: ${out}`);
  }
} finally {
  await browser.close();
}
