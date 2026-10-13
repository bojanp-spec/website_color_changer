import { rgbToHsl, rgbToOklch, toSrgbGamut } from './convert.js';
import type { ParsedColor } from './parse.js';
import type { RGBA } from './types.js';

/** Rounding without tails like 0.30000000000000004 and without `-0`. */
function round(n: number, digits: number): number {
  const f = 10 ** digits;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
const hex2 = (v: number) => byte(v).toString(16).padStart(2, '0');

export interface HexOptions {
  upper?: boolean;
}

/** `#rrggbb`, or `#rrggbbaa` when alpha < 1. Colors outside sRGB are gamut-mapped first. */
export function toHex(color: RGBA, opts: HexOptions = {}): string {
  const c = toSrgbGamut(color);
  let out = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  if (byte(c.a) < 255) out += hex2(c.a);
  return opts.upper ? out.toUpperCase() : out;
}

function alphaPart(a: number, legacy: boolean): string {
  const v = round(a, 3);
  if (v >= 1) return '';
  return legacy ? `, ${v}` : ` / ${v}`;
}

export interface FunctionalOptions {
  /** Legacy comma syntax (`rgba(1, 2, 3, 0.5)`). */
  legacy?: boolean;
}

export function toRgbString(color: RGBA, opts: FunctionalOptions = {}): string {
  const c = toSrgbGamut(color);
  const [r, g, b] = [byte(c.r), byte(c.g), byte(c.b)];
  if (opts.legacy) {
    return c.a < 1 && round(c.a, 3) < 1 ? `rgba(${r}, ${g}, ${b}${alphaPart(c.a, true)})` : `rgb(${r}, ${g}, ${b})`;
  }
  return `rgb(${r} ${g} ${b}${alphaPart(c.a, false)})`;
}

export function toHslString(color: RGBA, opts: FunctionalOptions = {}): string {
  const { h, s, l, a } = rgbToHsl(toSrgbGamut(color));
  const H = round(h, 1);
  const S = round(s * 100, 1);
  const L = round(l * 100, 1);
  if (opts.legacy) {
    return round(a, 3) < 1 ? `hsla(${H}, ${S}%, ${L}%${alphaPart(a, true)})` : `hsl(${H}, ${S}%, ${L}%)`;
  }
  return `hsl(${H} ${S}% ${L}%${alphaPart(a, false)})`;
}

/** `oklch(L C H)` — L in percent. Not gamut-mapped (CSS does that itself for oklch). */
export function toOklchString(color: RGBA): string {
  const { l, c, h, a } = rgbToOklch(color);
  return `oklch(${round(l * 100, 2)}% ${round(c, 4)} ${round(c < 1e-4 ? 0 : h, 2)}${alphaPart(a, false)})`;
}

/**
 * Writes the new color in the same syntactic form as the original, so the modified CSS
 * stays as close to the source as possible (HEX stays HEX, `rgba(…, …)` keeps commas, etc.).
 * Named colors become HEX; lab/lch/oklab/color() become oklch().
 */
export function formatLike(original: ParsedColor, color: RGBA): string {
  const legacy = original.legacy === true;
  switch (original.format) {
    case 'hex':
      return toHex(color, { upper: original.upper === true });
    case 'named':
      return toHex(color);
    case 'rgb':
      return toRgbString(color, { legacy });
    case 'hsl':
    case 'hwb':
      return toHslString(color, { legacy });
    default:
      return toOklchString(color);
  }
}
