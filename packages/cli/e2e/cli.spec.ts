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

function cli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    // Drop CC_LANG/LANG from the test environment unless the test sets them — the language depends only on the arguments.
    const base = { ...process.env, CC_LANG: '', LANG: '', LC_ALL: '' };
    execFile(process.execPath, [CLI, ...args], { timeout: 110_000, env: { ...base, ...env } }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout, stderr });
    });
  });
}

function outDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-export-'));
  return { dir, css: join(dir, 'theme.css'), map: join(dir, 'map.json'), report: join(dir, 'report.json') };
}

const readReport = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as ExportReport;

test('multiple pages (--crawl): one CSS for the whole site, verification passes', async () => {
  const o = outDir();
  const r = await cli([`${BASE}/multi/`, '--palette', 'crveno-sivo', '--crawl', '5', '--out', o.css, '--report', o.report, '--lang', 'sr']);
  expect(r.code, r.stderr || r.stdout).toBe(0);
  const css = readFileSync(o.css, 'utf8');
  expect(css).toContain('body {\n  background-color: #fafafa;');
  expect(css).toContain('.quote {'); // only on the "About us" page, found by following a link
  expect(css).toContain('.btn:hover {');
  const report = readReport(o.report);
  // the external link and the PDF are not visited; each page in two viewports
  expect([...new Set(report.pages.map((p) => p.url))]).toEqual([`${BASE}/multi/`, `${BASE}/multi/about.html`]);
  expect(report.pages.map((p) => p.viewport)).toEqual([1440, 390, 1440, 390]);
  expect(report.verification.every((v) => v.contrastRegressions.length === 0)).toBe(true);
  // inline `style="color:#2563eb"` can't be covered by a CSS file — and that gets reported
  expect(report.verification.find((v) => v.url.endsWith('about.html'))!.uncovered).toEqual([
    expect.objectContaining({ selector: 'p', property: 'color', color: '#2563eb' }),
  ]);
  expect(r.stdout).toContain('provera: kontrast svih tekstova OK');
});

test('drmozgovich.top (snapshot): local CTA text fix becomes a CSS rule', async () => {
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

test('cross-check: CSS layer and PostCSS-rewritten source CSS produce the same colors', async ({ page }) => {
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

  // A: original + exported layer (as it would ship to production)
  await page.goto('/blue-gray-plain/');
  await page.addStyleTag({ content: readFileSync(o.css, 'utf8') });
  const withLayer = await probe();

  // B: source CSS files rewritten by the PostCSS plugin, no layer
  const rewrite = async (file: string, localRules: 'append' | 'ignore') =>
    (await postcss([ccRemap({ map: o.map, localRules })]).process(readFileSync(join(FIXTURES, 'blue-gray-plain', file), 'utf8'), { from: undefined })).css;
  // Local contrast fixes (text on the yellow CTA) go into the main stylesheet.
  const styles = await rewrite('styles.css', 'append');
  const base = await rewrite('base.css', 'ignore');
  await page.route('**/blue-gray-plain/styles.css', (route) => route.fulfill({ contentType: 'text/css', body: styles }));
  await page.route('**/blue-gray-plain/base.css', (route) => route.fulfill({ contentType: 'text/css', body: base }));
  await page.goto('/blue-gray-plain/');
  const rewritten = await probe();

  expect(rewritten).toEqual(withLayer);
  expect(styles).toContain('url("data:image/png;base64,iVBORw0KGgo=")'); // url() untouched
});

test('clear errors for invalid arguments', async () => {
  const noUrl = await cli(['--lang', 'sr']);
  expect(noUrl.code).toBe(1);
  expect(noUrl.stdout).toContain('Upotreba:');
  const bad = await cli([`${BASE}/multi/`, '--palette', '#fff,nije-boja,#000', '--lang', 'sr']);
  expect(bad.code).toBe(1);
  expect(bad.stderr).toContain('Nevalidna boja u --palette: "nije-boja"');
  const badEn = await cli([`${BASE}/multi/`, '--palette', '#fff,not-a-color,#000', '--lang', 'en']);
  expect(badEn.stderr).toContain('Invalid color in --palette: "not-a-color"');
  const override = await cli([`${BASE}/multi/`, '--palette', 'crveno-sivo', '--override', '#fff=glavna']);
  expect(override.stderr).toContain('--override');
});

test('English output and CSS comments; language from the environment', async () => {
  const o = outDir();
  const r = await cli([`${BASE}/multi/`, '--palette', 'tirkiz-okean', '--viewports', '1440', '--out', o.css, '--lang', 'en']);
  expect(r.code, r.stderr || r.stdout).toBe(0);
  expect(r.stdout).toContain('scanned http://127.0.0.1:4173/multi/ @1440px');
  expect(r.stdout).toContain('verification: contrast of all texts OK');
  expect(r.stdout).toMatch(/✔ .*theme\.css: \d+ rules for 1 pages/);
  expect(r.stdout).not.toMatch(/skenirano|provera|pravila/);
  const css = readFileSync(o.css, 'utf8');
  expect(css).toContain("Include AFTER all of the site's existing styles.");
  expect(css).toContain(' * Palette: #F1F8FA (60%)');

  // without --lang: Serbian system → Serbian, anything else → English
  const sr = await cli([], { LANG: 'sr_RS.UTF-8' });
  expect(sr.stdout).toContain('Upotreba:');
  const en = await cli([], { LANG: 'de_DE.UTF-8' });
  expect(en.stdout).toContain('Usage:');
  expect(en.stdout).toContain('tirkiz-okean (Teal / ocean)');
});
