#!/usr/bin/env node
// Pravi statički snimak sajta za testove: renderovan HTML bez <script>-ova + lokalne kopije CSS-a.
//
//   node scripts/snapshot-site.mjs https://drmozgovich.top fixtures/drmozgovich
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) {
  console.error('Upotreba: node scripts/snapshot-site.mjs <url> <izlazni-direktorijum>');
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
    // Bez JS-a: snimak je statičan i deterministički (struktura i boje ostaju).
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
    // Preuzimanje iz browsera (isti mrežni put/proxy kao stranica).
    const text = await page.evaluate((href) => fetch(href).then((r) => r.text()), s.href);
    // Relativni url()-ovi u CSS-u (fontovi) → apsolutni, da snimak ne zavisi od putanje.
    const css = text.replace(/url\((['"]?)(\/(?!\/)[^)'"]*)\1\)/g, (_, q, p) => `url(${q}${new URL(p, s.href).href}${q})`);
    await writeFile(join(outDir, s.name), css);
  }
  await writeFile(join(outDir, 'index.html'), `<!-- Snimak ${url} (${new Date().toISOString().slice(0, 10)}), bez JS-a. -->\n${html}`);
  console.log(`Snimljeno: ${outDir} (${sheets.length} CSS)`);
} finally {
  await browser.close();
}
