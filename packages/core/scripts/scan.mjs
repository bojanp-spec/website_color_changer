#!/usr/bin/env node
// Scans a site's color palette in headless Chromium and prints it to the terminal.
//
//   npm run scan -- https://example.com [--json out.json] [--width 1440] [--no-scroll] [--dark]
//                   [--palette crveno-sivo | --palette "#FAFAFA,#4B4B4F,#D32F2F"] [--all]
//
// --palette: classifies colors (60-30-10) and shows the old → new color map for the chosen palette.
// --all: also show colors that don't change in the map.
// --screenshot <dir>: full-page screenshots before and after applying the palette (original.png, <palette>.png).
// --css <file>: export the CSS layer for permanent use (with --palette).
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
if (!url) {
  console.error('Usage: npm run scan -- <url> [--json out.json] [--width 1440] [--no-scroll] [--dark] [--palette <preset | "#dom,#sec,#acc">]');
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
    async ({ palette, all }) => {
      const CC = window.CC;
      const result = await CC.scanDocument(document);
      const swatch = (hex) => {
        const n = parseInt(hex.slice(1, 7), 16);
        return `\x1b[48;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m      \x1b[0m `;
      };
      const usages = result.usages.map(({ element, ...u }) => (element ? { ...u, element: element.localName } : u));
      const { pairElements: _p, scopes: _s, ...plain } = result;
      const json = { url: location.href, ...plain, usages };
      if (!palette) return { text: CC.formatPalette(result, swatch), json };

      let chosen = CC.PRESETS[palette];
      if (!chosen) {
        const [dominant, secondary, accent] = palette.split(',').map((x) => x.trim());
        chosen = { dominant, secondary, accent };
      }
      try {
        const c = CC.classify(result);
        const m = CC.buildColorMap(c, chosen, result.pairs);
        json.classification = { bases: c.bases, altBases: c.altBases, roles: [...c.roles.values()] };
        json.colorMap = m.entries;
        const shown = all ? m : { ...m, entries: m.entries.filter((e) => e.role !== 'protected') };
        const head = `Palette: ${chosen.dominant} / ${chosen.secondary} / ${chosen.accent}` +
          `   (site: ${c.bases.dominant} / ${c.bases.secondary} / ${c.bases.accent ?? '—'})`;
        return { text: CC.formatPalette(result, swatch), json, mapText: `${head}\n${CC.formatColorMap(shown, swatch)}` };
      } catch (e) {
        return { text: CC.formatPalette(result, swatch), json, error: String(e?.message ?? e) };
      }
    },
    { palette: opt('--palette'), all: args.includes('--all') },
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
    const report = await page.evaluate(async (palette) => {
      const CC = window.CC;
      let chosen = CC.PRESETS[palette];
      if (!chosen) {
        const [dominant, secondary, accent] = palette.split(',').map((x) => x.trim());
        chosen = { dominant, secondary, accent };
      }
      const engine = CC.createEngine(document);
      await engine.analyze();
      const r = engine.apply(chosen);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      return { css: engine.exportCss(), rules: r.rules, patched: r.patchedElements, fixes: r.localContrastFixes, fallback: r.fallbackPatched };
    }, opt('--palette'));
    console.log(`\n🎨 Applied: ${report.rules} CSS rules, ${report.patched} elements with modified attributes` +
      (report.fallback ? `, ${report.fallback} via computed fallback` : ''));
    for (const f of report.fixes) {
      const via = f.via.kind === 'variable' ? `variable ${f.via.name}` : `inline on ${f.via.elements} elements`;
      console.log(`   ⚖ local contrast: ${f.fg} on ${f.bg} → ${f.to} (${via})`);
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
