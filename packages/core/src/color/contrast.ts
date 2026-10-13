import { oklchToRgbInGamut, rgbToOklch, srgbToLinear, toSrgbGamut } from './convert.js';
import type { RGBA } from './types.js';

const WHITE: RGBA = { r: 1, g: 1, b: 1, a: 1 };

/** Alpha compositing: `fg` over `bg` (sRGB, the way the browser paints it). */
export function composite(fg: RGBA, bg: RGBA): RGBA {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (f: number, b: number) => (f * fg.a + b * bg.a * (1 - fg.a)) / a;
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a };
}

/** WCAG 2.x relative luminance (0 = black, 1 = white). */
export function relativeLuminance(color: RGBA): number {
  const c = toSrgbGamut(color);
  return 0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b);
}

/**
 * WCAG 2.x contrast ratio (1..21). A translucent background is first composited over `canvas`
 * (white by default), and translucent text over the resulting background.
 */
export function contrastRatio(fg: RGBA, bg: RGBA, canvas: RGBA = WHITE): number {
  const solidBg = bg.a < 1 ? composite(bg, canvas) : bg;
  const solidFg = fg.a < 1 ? composite(fg, solidBg) : fg;
  const l1 = relativeLuminance(solidFg);
  const l2 = relativeLuminance(solidBg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export type WcagLevel = 'AA' | 'AAA';

/**
 * Minimum contrast per WCAG 2.x. "Large text" = ≥ 24px, or ≥ 18.66px (14pt) bold.
 */
export function requiredContrast(level: WcagLevel, largeText = false): number {
  if (level === 'AAA') return largeText ? 4.5 : 7;
  return largeText ? 3 : 4.5;
}

export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
}

export interface ContrastFix {
  color: RGBA;
  ratio: number;
  /** `false` if the color already met the target. */
  adjusted: boolean;
  /** `false` if the target is unreachable even with black/white (e.g. mid-gray background and 7:1). */
  reached: boolean;
}

export interface EnsureContrastOptions {
  /** Allowed direction of text lightness change. Both by default (picks the smaller shift). */
  direction?: 'darker' | 'lighter';
  canvas?: RGBA;
}

/**
 * Shifts the text's OKLCH lightness (hue and chroma stay) until the contrast against the background
 * reaches `target`. Picks the direction (darker or lighter) that can reach the target
 * with the smallest lightness change, unless a direction is given.
 */
export function ensureContrast(fg: RGBA, bg: RGBA, target: number, opts: EnsureContrastOptions = {}): ContrastFix {
  const canvas = opts.canvas ?? WHITE;
  const initial = contrastRatio(fg, bg, canvas);
  if (initial >= target) return { color: fg, ratio: initial, adjusted: false, reached: true };

  const lch = rgbToOklch(toSrgbGamut(fg));
  const at = (l: number) => oklchToRgbInGamut({ ...lch, l });
  const ratioAt = (l: number) => contrastRatio(at(l), bg, canvas);

  type Candidate = { l: number; ratio: number };
  const candidates: Candidate[] = [];
  const extremes = opts.direction === 'darker' ? [0] : opts.direction === 'lighter' ? [1] : [0, 1];
  for (const extreme of extremes) {
    if (ratioAt(extreme) < target) continue;
    // Binary search between the current lightness and the extreme.
    let near = lch.l;
    let far = extreme;
    for (let i = 0; i < 30; i++) {
      const mid = (near + far) / 2;
      if (ratioAt(mid) >= target) far = mid;
      else near = mid;
    }
    candidates.push({ l: far, ratio: ratioAt(far) });
  }

  if (!candidates.length) {
    // Target unreachable — return the extreme with the best contrast.
    const best = extremes.length === 1 ? extremes[0]! : ratioAt(0) >= ratioAt(1) ? 0 : 1;
    return { color: at(best), ratio: ratioAt(best), adjusted: true, reached: false };
  }

  const best = candidates.reduce((x, y) => (Math.abs(x.l - lch.l) <= Math.abs(y.l - lch.l) ? x : y));
  return { color: at(best.l), ratio: best.ratio, adjusted: true, reached: true };
}
