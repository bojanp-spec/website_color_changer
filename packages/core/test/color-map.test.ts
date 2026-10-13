import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildColorMap, classify, contrastRatio, formatColorMap, parseColor, PRESETS, rgbToOklch } from '../src/index.js';
import type { ScanSummary } from '../src/index.js';

const site = JSON.parse(readFileSync(new URL('./fixtures/drmozgovich.scan.json', import.meta.url), 'utf8')) as ScanSummary;
const c = classify(site);
const L = (hex: string) => rgbToOklch(parseColor(hex)!.rgba).l;
const H = (hex: string) => rgbToOklch(parseColor(hex)!.rgba).h;
const rgba = (hex: string) => parseColor(hex)!.rgba;
const LIGHT = Object.keys(PRESETS).filter((k) => L(PRESETS[k]!.dominant) > 0.5);
const DARK = Object.keys(PRESETS).filter((k) => !LIGHT.includes(k));

/** Pairs that fall short of min(AA, original) after mapping. */
function failingPairs(map: Map<string, string>) {
  return site.pairs.filter((p) => {
    if (!map.has(p.fg) || !map.has(p.bg)) return false;
    const target = Math.min(p.hasSmallText ? 4.5 : 3, contrastRatio(rgba(p.fg), rgba(p.bg)));
    return contrastRatio(rgba(map.get(p.fg)!), rgba(map.get(p.bg)!)) < target - 0.05;
  });
}

describe('buildColorMap — drmozgovich.top', () => {
  it('base colors get exactly the chosen colors', () => {
    const m = buildColorMap(c, PRESETS['crveno-sivo']!, site.pairs, { enforceContrast: false });
    expect(m.map.get('#f4f6fa')).toBe('#fafafa');
    expect(m.map.get('#10233f')).toBe('#4b4b4f');
    expect(m.map.get('#3e9fd9')).toBe('#d32f2f');
  });

  it('protected colors stay the same', () => {
    const m = buildColorMap(c, PRESETS['crveno-sivo']!, site.pairs);
    for (const key of ['#3d6b47', '#c2a06a', '#000000']) expect(m.map.get(key)).toBe(key);
  });

  it('is deterministic', () => {
    const a = buildColorMap(c, PRESETS['zuto-zeleno']!, site.pairs);
    const b = buildColorMap(c, PRESETS['zuto-zeleno']!, site.pairs);
    expect([...a.map]).toEqual([...b.map]);
  });

  it('has 9 ready-made palettes (10 in the panel with Original), all distinct', () => {
    expect(Object.keys(PRESETS)).toHaveLength(9);
    expect(new Set(Object.values(PRESETS).map((p) => `${p.dominant}${p.secondary}${p.accent}`.toLowerCase())).size).toBe(9);
    expect(DARK).toEqual(['narandzasto-tamno', 'ponoc-zlatno']);
  });

  it.each(LIGHT)('%s: preserves the lightness hierarchy and fixes contrast', (name) => {
    const m = buildColorMap(c, PRESETS[name]!, site.pairs);
    const to = (k: string) => m.map.get(k)!;
    // backgrounds stay light, text darker than background, secondary text lighter than main text
    expect(L(to('#f4f6fa'))).toBeGreaterThan(0.9);
    expect(L(to('#10233f'))).toBeLessThan(L(to('#4c5975')));
    expect(L(to('#4c5975'))).toBeLessThan(L(to('#8791a8')));
    // accent wash is light and in the new accent's hue
    expect(L(to('#e7f2fa'))).toBeGreaterThan(0.85);
    // the only remaining issue is CTA button text that shares its color with the main text (solved by M4)
    const failing = failingPairs(m.map).map((p) => `${p.fg}|${p.bg}`);
    expect(failing.filter((f) => !f.endsWith('|#3e9fd9'))).toEqual([]);
  });

  it("the site's dark mode stays dark with a new (light) palette", () => {
    const m = buildColorMap(c, PRESETS['crveno-sivo']!, site.pairs);
    expect(L(m.map.get('#0b1626')!)).toBeLessThan(0.3);
    expect(L(m.map.get('#eef2f8')!)).toBeGreaterThan(0.9);
    // dark mode lines stay visible (lighter than the background)
    expect(L(m.map.get('#223752')!)).toBeGreaterThan(L(m.map.get('#0b1626')!) + 0.05);
    expect(Math.abs(H(m.map.get('#6cc0f0')!) - H('#d32f2f'))).toBeLessThan(15);
  });

  it('a dark palette on a light site inverts lightness relationships', () => {
    const m = buildColorMap(c, PRESETS['narandzasto-tamno']!, site.pairs);
    const to = (k: string) => m.map.get(k)!;
    expect(to('#f4f6fa')).toBe('#121212');
    expect(to('#10233f')).toBe('#d0d0d0');
    // secondary text is now DARKER than main text (less contrast on a dark background)
    expect(L(to('#4c5975'))).toBeLessThan(L(to('#10233f')));
    // surfaces/lines lighter than the dark background
    expect(L(to('#dde3ee'))).toBeGreaterThan(L(to('#f4f6fa')));
    expect(L(to('#ffffff'))).toBeGreaterThan(L(to('#f4f6fa')));
    // accent wash becomes dark
    expect(L(to('#e7f2fa'))).toBeLessThan(0.5);
    // the site's dark mode uses the new dark palette directly
    expect(to('#0b1626')).toBe('#121212');
    // semantic green takes its value from the site's dark mode
    expect(to('#3d6b47')).toBe('#82b58f');
    const failing = failingPairs(m.map).map((p) => `${p.fg}|${p.bg}`);
    expect(failing.filter((f) => !f.endsWith('|#3e9fd9'))).toEqual([]);
  });

  it.each(DARK)('%s: dark palette — dark backgrounds, light text, contrast OK', (name) => {
    const m = buildColorMap(c, PRESETS[name]!, site.pairs);
    const to = (k: string) => m.map.get(k)!;
    expect(L(to('#f4f6fa'))).toBeLessThan(0.3);
    expect(L(to('#10233f'))).toBeGreaterThan(0.75);
    expect(L(to('#4c5975'))).toBeLessThan(L(to('#10233f')));
    expect(L(to('#0b1626'))).toBeLessThan(0.3);
    const failing = failingPairs(m.map).map((p) => `${p.fg}|${p.bg}`);
    expect(failing.filter((f) => !f.endsWith('|#3e9fd9'))).toEqual([]);
  });

  it('correction does not flip direction: main text stays dark', () => {
    for (const name of LIGHT) {
      const m = buildColorMap(c, PRESETS[name]!, site.pairs);
      expect(L(m.map.get('#10233f')!), name).toBeLessThan(0.5);
      expect(L(m.map.get('#f4f6fa')!), name).toBeGreaterThan(0.9);
    }
  });

  it('warns about CTA button text that cannot be fixed globally', () => {
    const m = buildColorMap(c, PRESETS['crveno-sivo']!, site.pairs);
    expect(m.warnings.some((w) => w.startsWith('#10233f na #3e9fd9'))).toBe(true);
  });

  it('an invalid palette color throws a clear error', () => {
    expect(() => buildColorMap(c, { dominant: '#fff', secondary: 'nije-boja', accent: '#f00' })).toThrow(/sekundarnu/);
  });

  it('formatColorMap', () => {
    const text = formatColorMap(buildColorMap(c, PRESETS['crveno-sivo']!, site.pairs));
    expect(text).toContain('DOMINANTNA (60%)');
    expect(text).toContain('#3e9fd9    → #d32f2f');
  });
});
