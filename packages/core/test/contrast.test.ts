import { describe, expect, it } from 'vitest';
import {
  composite,
  contrastRatio,
  ensureContrast,
  isLargeText,
  parseColor,
  relativeLuminance,
  requiredContrast,
  rgbToOklch,
} from '../src/index.js';

const c = (s: string) => parseColor(s)!.rgba;

describe('WCAG kontrast', () => {
  it('poznate vrednosti', () => {
    expect(contrastRatio(c('#000'), c('#fff'))).toBeCloseTo(21, 5);
    expect(contrastRatio(c('#fff'), c('#fff'))).toBeCloseTo(1, 5);
    expect(contrastRatio(c('#777'), c('#fff'))).toBeCloseTo(4.48, 2);
    expect(contrastRatio(c('#767676'), c('#fff'))).toBeCloseTo(4.54, 2);
    // simetričnost
    expect(contrastRatio(c('#1e3a8a'), c('#f1f5f9'))).toBeCloseTo(contrastRatio(c('#f1f5f9'), c('#1e3a8a')), 10);
  });

  it('luminansa', () => {
    expect(relativeLuminance(c('#fff'))).toBeCloseTo(1, 10);
    expect(relativeLuminance(c('#000'))).toBe(0);
  });

  it('providne boje se slažu pre merenja', () => {
    // 50% crna preko bele ≈ #808080
    expect(contrastRatio(c('rgb(0 0 0 / .5)'), c('#fff'))).toBeCloseTo(contrastRatio(c('#808080'), c('#fff')), 1);
    // potpuno providna pozadina = canvas (bela)
    expect(contrastRatio(c('#000'), c('rgb(255 0 0 / 0)'))).toBeCloseTo(21, 5);
    expect(composite(c('rgb(255 0 0 / 0)'), c('rgb(0 0 0 / 0)')).a).toBe(0);
  });

  it('pragovi', () => {
    expect(requiredContrast('AA')).toBe(4.5);
    expect(requiredContrast('AA', true)).toBe(3);
    expect(requiredContrast('AAA')).toBe(7);
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(19, 700)).toBe(true);
    expect(isLargeText(19, 400)).toBe(false);
  });
});

describe('ensureContrast', () => {
  it('ne dira boju koja već prolazi', () => {
    const r = ensureContrast(c('#000'), c('#fff'), 4.5);
    expect(r).toMatchObject({ adjusted: false, reached: true });
    expect(r.color).toEqual(c('#000'));
  });

  it('bela slova na žutom CTA dugmetu postaju tamna', () => {
    const r = ensureContrast(c('#fff'), c('#F2B705'), 4.5);
    expect(r.reached).toBe(true);
    expect(r.ratio).toBeGreaterThanOrEqual(4.5);
    expect(r.ratio).toBeLessThan(4.7); // minimalna promena, ne skok na crnu
    expect(rgbToOklch(r.color).l).toBeLessThan(0.5);
  });

  it('čuva nijansu teksta', () => {
    const fg = c('#e57373'); // svetlocrvena na beloj — pada
    const r = ensureContrast(fg, c('#fff'), 4.5);
    expect(r.ratio).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(rgbToOklch(r.color).h - rgbToOklch(fg).h)).toBeLessThan(3);
  });

  it('nedostižan cilj vraća najbolji ekstrem', () => {
    const r = ensureContrast(c('#808080'), c('#777'), 7);
    expect(r.reached).toBe(false);
    expect(r.adjusted).toBe(true);
  });
});
