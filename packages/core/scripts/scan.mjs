#!/usr/bin/env node
// Skenira paletu boja sajta u headless Chromium-u i ispisuje je u terminal.
//
//   npm run scan -- https://example.com [--json out.json] [--width 1440] [--no-scroll] [--dark]
//
// Lokalno je potreban Chromium za Playwright: `npx playwright install chromium`.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a) || a.startsWith('file:'));
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
if (!url) {
  console.error('Upotreba: npm run scan -- <url> [--json out.json] [--width 1440] [--no-scroll] [--dark]');
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
    // Lazy-load sadržaj: skroluj do dna, pa nazad na vrh.
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
  const { text, json } = await page.evaluate(async () => {
    const result = await window.CC.scanDocument(document);
    const swatch = (hex) => {
      const n = parseInt(hex.slice(1, 7), 16);
      return `\x1b[48;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m      \x1b[0m `;
    };
    const usages = result.usages.map(({ element, ...u }) => (element ? { ...u, element: element.localName } : u));
    return { text: window.CC.formatPalette(result, swatch), json: { url: location.href, ...result, usages } };
  });

  console.log(`\n🎨 ${url}  (viewport ${width}px)\n`);
  console.log(text);
  const out = opt('--json');
  if (out) {
    writeFileSync(out, JSON.stringify(json, null, 2));
    console.log(`\nJSON: ${out}`);
  }
} finally {
  await browser.close();
}
