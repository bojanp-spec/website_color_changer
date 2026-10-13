import { describe, expect, it } from 'vitest';
import {
  deltaEOK,
  inSrgbGamut,
  oklchToRgb,
  oklchToRgbInGamut,
  parseColor,
  rgbToHsl,
  rgbToOklch,
} from '../src/index.js';
import type { RGBA } from '../src/index.js';

const rgb = (r: number, g: number, b: number, a = 1): RGBA => ({ r: r / 255, g: g / 255, b: b / 255, a });

describe('OKLCH', () => {
  it('known reference values', () => {
    const red = rgbToOklch(rgb(255, 0, 0));
    expect(red.l).toBeCloseTo(0.62796, 4);
    expect(red.c).toBeCloseTo(0.25768, 4);
    expect(red.h).toBeCloseTo(29.23, 1);

    const white = rgbToOklch(rgb(255, 255, 255));
    expect(white.l).toBeCloseTo(1, 4);
    expect(white.c).toBeLessThan(1e-4);
    expect(white.h).toBe(0);
  });

  it('round-trip sRGB → OKLCH → sRGB is lossless', () => {
    for (let i = 0; i < 500; i++) {
      const c = rgb(Math.random() * 255, Math.random() * 255, Math.random() * 255, Math.random());
      const back = oklchToRgb(rgbToOklch(c));
      // Ottosson's matrices have 10 decimals → error ~1e-6, far below 1/255.
      expect(Math.abs(back.r - c.r)).toBeLessThan(1e-5);
      expect(Math.abs(back.g - c.g)).toBeLessThan(1e-5);
      expect(Math.abs(back.b - c.b)).toBeLessThan(1e-5);
      expect(back.a).toBe(c.a);
    }
  });

  it('blue-gray (Tailwind slate-500) has low chroma and a blue hue', () => {
    const slate = rgbToOklch(parseColor('#64748b')!.rgba);
    expect(slate.c).toBeGreaterThan(0.01);
    expect(slate.c).toBeLessThan(0.05);
    expect(slate.h).toBeGreaterThan(240);
    expect(slate.h).toBeLessThan(270);
  });
});

describe('gamut mapping', () => {
  it('an in-gamut color stays the same', () => {
    const c = rgbToOklch(rgb(30, 58, 138));
    const out = oklchToRgbInGamut(c);
    expect(out.r * 255).toBeCloseTo(30, 3);
    expect(out.b * 255).toBeCloseTo(138, 3);
  });

  it('an out-of-gamut color is brought into sRGB, preserving lightness and hue', () => {
    const wild = { l: 0.7, c: 0.4, h: 145, a: 1 };
    expect(inSrgbGamut(oklchToRgb(wild))).toBe(false);
    const mapped = oklchToRgbInGamut(wild);
    expect(inSrgbGamut(mapped)).toBe(true);
    const back = rgbToOklch(mapped);
    expect(back.l).toBeCloseTo(0.7, 1);
    expect(Math.abs(back.h - 145)).toBeLessThan(5);
    expect(back.c).toBeLessThan(0.4);
  });

  it('extreme lightness yields white/black', () => {
    expect(oklchToRgbInGamut({ l: 1.2, c: 0.3, h: 30, a: 1 })).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(oklchToRgbInGamut({ l: 0, c: 0.3, h: 30, a: 0.5 })).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  });
});

describe('misc', () => {
  it('deltaEOK', () => {
    expect(deltaEOK(rgb(10, 20, 30), rgb(10, 20, 30))).toBe(0);
    expect(deltaEOK(rgb(0, 0, 0), rgb(255, 255, 255))).toBeCloseTo(1, 3);
  });

  it('rgbToHsl', () => {
    const { h, s, l } = rgbToHsl(rgb(0, 128, 0));
    expect(h).toBeCloseTo(120, 5);
    expect(s).toBeCloseTo(1, 5);
    expect(l).toBeCloseTo(0.251, 3);
    expect(rgbToHsl(rgb(128, 128, 128)).s).toBe(0);
  });
});
