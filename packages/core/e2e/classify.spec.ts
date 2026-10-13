import { expect, test } from '@playwright/test';
import { BUNDLE } from './helpers.js';
import type { Page } from '@playwright/test';

type CCModule = typeof import('../src/index.js');

/** Scans the page, classifies, and builds the map for a preset — all in the browser. */
async function analyze(page: Page, preset = 'crveno-sivo') {
  await page.addScriptTag({ path: BUNDLE });
  return page.evaluate(async (presetName) => {
    const CC = (window as unknown as { CC: CCModule }).CC;
    const scan = await CC.scanDocument(document);
    const c = CC.classify(scan);
    const m = CC.buildColorMap(c, CC.PRESETS[presetName]!, scan.pairs);
    return {
      bases: c.bases,
      altBases: c.altBases,
      roles: Object.fromEntries([...c.roles].map(([k, r]) => [k, r.role])),
      map: Object.fromEntries(m.map),
      warnings: m.warnings,
    };
  }, preset);
}

test.describe('drmozgovich.top (static snapshot) — main test site', () => {
  test.beforeEach(async ({ page }) => {
    // The snapshot is fully local; the site's fonts/images are not loaded.
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await page.goto('/drmozgovich/');
  });

  test('60/30/10 bases and dark mode bases',async ({ page }) => {
    const r = await analyze(page);
    expect(r.bases).toEqual({ dominant: '#f4f6fa', secondary: '#10233f', accent: '#3e9fd9' });
    expect(r.altBases).toEqual({ dominant: '#0b1626', secondary: '#eef2f8', accent: '#6cc0f0' });
  });

  test('roles of key colors',async ({ page }) => {
    const r = await analyze(page);
    expect(r.roles).toMatchObject({
      '#dde3ee': 'dominant',
      '#ffffff': 'dominant',
      '#4c5975': 'secondary',
      '#1b6fa8': 'accent',
      '#e7f2fa': 'accent',
      '#3d6b47': 'protected',
      '#000000': 'protected',
    });
  });

  test('crveno-sivo: bases get the chosen colors',async ({ page }) => {
    const r = await analyze(page);
    expect(r.map).toMatchObject({ '#f4f6fa': '#fafafa', '#10233f': '#4b4b4f', '#3e9fd9': '#d32f2f' });
  });
});

test('blue-gray-vars fixture: roles and accent hover color', async ({ page }) => {
  await page.goto('/blue-gray-vars/');
  const r = await analyze(page);
  expect(r.bases).toEqual({ dominant: '#f8fafc', secondary: '#1e293b', accent: '#2563eb' });
  expect(r.roles).toMatchObject({
    '#1e3a8a': 'secondary', // dark blue header
    '#334155': 'secondary', // footer
    '#64748b': 'secondary', // muted text
    '#e2e8f0': 'dominant', // card borders
    '#1d4ed8': 'accent', // :hover CTA
    '#0f172a': 'dominant', // --bg in dark mode
  });
  expect(r.warnings).toEqual([]);
});

test('LIVE drmozgovich.top (only with LIVE=1)', async ({ page }) => {
  test.skip(!process.env.LIVE, 'requires network access to the site');
  await page.goto('https://drmozgovich.top', { waitUntil: 'networkidle' });
  const r = await analyze(page);
  expect(r.bases.dominant).toBe('#f4f6fa');
  expect(r.bases.accent).not.toBeNull();
});
