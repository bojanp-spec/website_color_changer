import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import ccRemap from 'postcss-cc-remap';
import type { ExportReport } from '../src/types.js';

const CLI = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const BASE = 'http://127.0.0.1:4173';

function cli(args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [CLI, ...args], { timeout: 110_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout, stderr });
    });
  });
}

function outDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-export-'));
  return { dir, css: join(dir, 'theme.css'), map: join(dir, 'map.json'), report: join(dir, 'report.json') };
}

const readReport = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as ExportReport;

test('više stranica (--crawl): jedan CSS za ceo sajt, provera prolazi', async () => {
  const o = outDir();
  const r = await cli([`${BASE}/multi/`, '--palette', 'crveno-sivo', '--crawl', '5', '--out', o.css, '--report', o.report]);
  expect(r.code, r.stderr || r.stdout).toBe(0);
  const css = readFileSync(o.css, 'utf8');
  expect(css).toContain('body {\n  background-color: #fafafa;');
  expect(css).toContain('.quote {'); // samo na stranici „O nama", pronađenoj praćenjem linka
  expect(css).toContain('.btn:hover {');
  const report = readReport(o.report);
  // spoljni link i PDF se ne obilaze; svaka stranica u dva prikaza
  expect([...new Set(report.pages.map((p) => p.url))]).toEqual([`${BASE}/multi/`, `${BASE}/multi/about.html`]);
  expect(report.pages.map((p) => p.viewport)).toEqual([1440, 390, 1440, 390]);
  expect(report.verification.every((v) => v.contrastRegressions.length === 0)).toBe(true);
  // inline `style="color:#2563eb"` CSS fajl ne može da pokrije — i to se prijavljuje
  expect(report.verification.find((v) => v.url.endsWith('about.html'))!.uncovered).toEqual([
    expect.objectContaining({ selector: 'p', property: 'color', color: '#2563eb' }),
  ]);
  expect(r.stdout).toContain('provera: kontrast svih tekstova OK');
});

test('drmozgovich.top (snimak): lokalna korekcija CTA teksta postaje CSS pravilo', async () => {
  const o = outDir();
  const r = await cli([`${BASE}/drmozgovich/`, '--palette', 'crveno-sivo', '--viewports', '1440', '--out', o.css, '--report', o.report]);
  expect(r.code, r.stderr || r.stdout).toBe(0);
  const css = readFileSync(o.css, 'utf8');
  expect(css).toContain(':root {\n  --paper: #fafafa;');
  expect(css).toMatch(/a\.btn\.btn-primary[^{]*\{\n {2}color: #f3f3f8;/);
  const report = readReport(o.report);
  expect(report.bases).toEqual({ dominant: '#f4f6fa', secondary: '#10233f', accent: '#3e9fd9' });
  expect(report.verification[0]!.contrastRegressions).toEqual([]);
  expect(report.warnings).toEqual([]);
});

test('unakrsna provera: CSS sloj i PostCSS-prepisani izvorni CSS daju iste boje', async ({ page }) => {
  const o = outDir();
  const r = await cli([`${BASE}/blue-gray-plain/`, '--palette', 'zuto-zeleno', '--viewports', '1440', '--out', o.css, '--map', o.map, '--no-verify']);
  expect(r.code, r.stderr || r.stdout).toBe(0);

  const probe = () =>
    page.evaluate(() =>
      ['body', '.topbar', '.topbar a', '.panel', '.list', '.cta', 'html'].map((sel) => {
        const cs = getComputedStyle(document.querySelector(sel)!);
        return [sel, cs.color, cs.backgroundColor, cs.backgroundImage, cs.borderTopColor];
      }),
    );

  // A: original + izvezeni sloj (kako bi išlo u produkciju)
  await page.goto('/blue-gray-plain/');
  await page.addStyleTag({ content: readFileSync(o.css, 'utf8') });
  const withLayer = await probe();

  // B: izvorni CSS fajlovi prepisani PostCSS plugin-om, bez sloja
  const rewrite = async (file: string, localRules: 'append' | 'ignore') =>
    (await postcss([ccRemap({ map: o.map, localRules })]).process(readFileSync(join(FIXTURES, 'blue-gray-plain', file), 'utf8'), { from: undefined })).css;
  // Lokalne korekcije kontrasta (tekst na žutom CTA) idu u glavni stylesheet.
  const styles = await rewrite('styles.css', 'append');
  const base = await rewrite('base.css', 'ignore');
  await page.route('**/blue-gray-plain/styles.css', (route) => route.fulfill({ contentType: 'text/css', body: styles }));
  await page.route('**/blue-gray-plain/base.css', (route) => route.fulfill({ contentType: 'text/css', body: base }));
  await page.goto('/blue-gray-plain/');
  const rewritten = await probe();

  expect(rewritten).toEqual(withLayer);
  expect(styles).toContain('url("data:image/png;base64,iVBORw0KGgo=")'); // url() netaknut
});

test('jasne greške za pogrešne argumente', async () => {
  const noUrl = await cli([]);
  expect(noUrl.code).toBe(1);
  expect(noUrl.stdout).toContain('Upotreba:');
  const bad = await cli([`${BASE}/multi/`, '--palette', '#fff,nije-boja,#000']);
  expect(bad.code).toBe(1);
  expect(bad.stderr).toContain('Nevalidna boja u --palette: "nije-boja"');
  const override = await cli([`${BASE}/multi/`, '--palette', 'crveno-sivo', '--override', '#fff=glavna']);
  expect(override.stderr).toContain('--override');
});
