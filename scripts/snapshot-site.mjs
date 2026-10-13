#!/usr/bin/env node
// Makes a static snapshot of a site for tests: rendered HTML without <script>s + local copies of the CSS.
//
//   node scripts/snapshot-site.mjs https://drmozgovich.top fixtures/drmozgovich
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) {
  console.error('Usage: node scripts/snapshot-site.mjs <url> <output-dir>');
  process.exit(1);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });

  const { html, sheets } = await page.evaluate(() => {
    const sheets = [];
    document.querySelectorAll('link[rel="stylesheet"]').forEach((link, i) => {
      const name = `style-${i}.css`;
      sheets.push({ href: link.href, name });
      link.setAttribute('href', name);
      link.removeAttribute('integrity');
      link.removeAttribute('crossorigin');
    });
    // No JS: the snapshot is static and deterministic (structure and colors are preserved).
    document.querySelectorAll('script, link[rel="preload"][as="script"], link[rel="modulepreload"], noscript').forEach((n) => n.remove());
    document.querySelectorAll('[src^="/"], [href^="/"], [srcset]').forEach((el) => {
      for (const attr of ['src', 'href']) {
        const v = el.getAttribute(attr);
        if (v?.startsWith('/') && !v.startsWith('//')) el.setAttribute(attr, new URL(v, location.origin).href);
      }
      el.removeAttribute('srcset');
    });
    return { html: '<!doctype html>\n' + document.documentElement.outerHTML, sheets };
  });

  await mkdir(outDir, { recursive: true });
  for (const s of sheets) {
    // Fetch from the browser (same network path/proxy as the page).
    const text = await page.evaluate((href) => fetch(href).then((r) => r.text()), s.href);
    // Relative url()s in the CSS (fonts) → absolute, so the snapshot doesn't depend on its path.
    const css = text.replace(/url\((['"]?)(\/(?!\/)[^)'"]*)\1\)/g, (_, q, p) => `url(${q}${new URL(p, s.href).href}${q})`);
    await writeFile(join(outDir, s.name), css);
  }
  await writeFile(join(outDir, 'index.html'), `<!-- Snapshot of ${url} (${new Date().toISOString().slice(0, 10)}), without JS. -->\n${html}`);
  console.log(`Saved: ${outDir} (${sheets.length} CSS)`);
} finally {
  await browser.close();
}
