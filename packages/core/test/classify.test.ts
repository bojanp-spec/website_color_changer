import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classify } from '../src/index.js';
import type { Role, ScanSummary } from '../src/index.js';

/** Snapshot of `npm run scan -- https://drmozgovich.top` (desktop 1440px, light). */
const site = JSON.parse(readFileSync(new URL('./fixtures/drmozgovich.scan.json', import.meta.url), 'utf8')) as ScanSummary;

const roleOf = (c: ReturnType<typeof classify>, key: string) => c.roles.get(key)?.role;

describe('classify — drmozgovich.top', () => {
  const c = classify(site);

  it('finds the 60/30/10 bases', () => {
    expect(c.light).toBe(true);
    expect(c.bases).toEqual({ dominant: '#f4f6fa', secondary: '#10233f', accent: '#3e9fd9' });
  });

  it.each<[string, Role]>([
    ['#dde3ee', 'dominant'], // --rule
    ['#ffffff', 'dominant'], // --sheet
    ['#c1c9db', 'dominant'], // --rule-strong
    ['#f4f6faf2', 'dominant'], // translucent header
    ['#4c5975', 'secondary'], // --muted
    ['#8791a8', 'secondary'], // --faint
    ['#1b6fa8', 'accent'], // --accent-ink
    ['#e7f2fa', 'accent'], // --accent-wash
  ])('visible %s → %s', (key, role) => {
    expect(roleOf(c, key)).toBe(role);
  });

  it.each<[string, Role]>([
    ['#0b1626', 'dominant'], // --paper (dark)
    ['#223752', 'dominant'], // --rule (dark)
    ['#eef2f8', 'secondary'], // --ink (dark)
    ['#a7b3c9', 'secondary'], // --muted (dark)
    ['#6cc0f0', 'accent'], // --accent-base (dark)
    ['#13293d', 'accent'], // --accent-wash (dark)
    ['#10233f40', 'secondary'], // shadow in the --ink color
  ])('dark mode / invisible %s → %s', (key, role) => {
    expect(roleOf(c, key)).toBe(role);
    if (!key.startsWith('#10233f')) expect(c.roles.get(key)?.scheme).toBe('alt');
  });

  it('dark mode bases', () => {
    expect(c.altBases).toEqual({ dominant: '#0b1626', secondary: '#eef2f8', accent: '#6cc0f0' });
  });

  it('semantic and chart colors are left alone', () => {
    for (const key of ['#3d6b47', '#d97f6c', '#9c4d3f', '#cf9a54', '#f5e8e5', '#c2a06a', '#7f96c0', '#6c5100']) {
      expect(roleOf(c, key), key).toBe('protected');
    }
  });

  it('masks, color-mix() operands and black shadows are left alone', () => {
    for (const key of ['#000000', '#0000001a', '#00000099']) {
      expect(c.roles.get(key)).toMatchObject({ role: 'protected', reason: 'samo maska / color-mix() / senka' });
    }
  });

  it('fully transparent colors are ignored', () => {
    expect(c.roles.has('#00000000')).toBe(false);
  });

  it('protectVariables: null — semantic colors join the palette too', () => {
    const all = classify(site, { protectVariables: null });
    expect(roleOf(all, '#3d6b47')).toBe('protected'); // still protected: hue outside the palette
    expect(roleOf(all, '#7f96c0')).not.toBe('protected'); // bluish chart color follows the palette
  });

  it('manual overrides take precedence', () => {
    expect(roleOf(classify(site, { overrides: { '#e7f2fa': 'dominant' } }), '#e7f2fa')).toBe('dominant');
  });
});

describe('classify — synthetic site without an accent', () => {
  const w = (bg: number, text = 0, interactive = 0) => ({ bgArea: bg, textArea: text, borderArea: 0, svgArea: 0, interactiveArea: interactive });
  const scan: ScanSummary = {
    palette: [
      { key: '#ffffff', area: 1000, weight: w(1000), variables: [] },
      { key: '#333333', area: 300, weight: w(0, 300), variables: [] },
      { key: '#666666', area: 100, weight: w(0, 100, 50), variables: [] },
    ],
    usages: [],
    pairs: [],
  };

  it('accent is null, other roles work', () => {
    const c = classify(scan);
    expect(c.bases).toEqual({ dominant: '#ffffff', secondary: '#333333', accent: null });
    expect(roleOf(c, '#666666')).toBe('secondary');
  });

  it('an empty palette throws', () => {
    expect(() => classify({ palette: [], usages: [], pairs: [] })).toThrow();
  });
});

describe('classify — multicolor SVG graphic (logo)', () => {
  const w = (bg: number, text = 0, interactive = 0) => ({ bgArea: bg, textArea: text, borderArea: 0, svgArea: 0, interactiveArea: interactive });
  const scan: ScanSummary = {
    palette: [
      { key: '#ffffff', area: 1000, weight: w(1000), variables: [] },
      { key: '#222222', area: 300, weight: w(0, 300), variables: [] },
      { key: '#2563eb', area: 20, weight: w(20, 0, 20), variables: [] },
      { key: '#4285f4', area: 5, weight: { ...w(0), svgArea: 5 }, variables: [] },
    ],
    usages: [{ source: 'svg-attr', property: 'fill', value: '#4285F4', colors: ['#4285f4'], multicolorSvg: true }],
    pairs: [],
  };

  it('Google logo blue stays, even though it shares the accent hue', () => {
    const c = classify(scan);
    expect(c.bases.accent).toBe('#2563eb');
    expect(c.roles.get('#4285f4')).toMatchObject({ role: 'protected', reason: 'višebojna SVG grafika (logo)' });
  });
});
