import { rgbToHsl, rgbToOklch, toSrgbGamut } from './convert.js';
import type { ParsedColor } from './parse.js';
import type { RGBA } from './types.js';

/** Zaokruživanje bez repova tipa 0.30000000000000004 i bez `-0`. */
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

/** `#rrggbb`, ili `#rrggbbaa` kada je alfa < 1. Boja van sRGB se prvo gamut-mapira. */
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
  /** Stara sintaksa sa zarezima (`rgba(1, 2, 3, 0.5)`). */
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

/** `oklch(L C H)` — L u procentima. Ne gamut-mapira (CSS to radi sam za oklch). */
export function toOklchString(color: RGBA): string {
  const { l, c, h, a } = rgbToOklch(color);
  return `oklch(${round(l * 100, 2)}% ${round(c, 4)} ${round(c < 1e-4 ? 0 : h, 2)}${alphaPart(a, false)})`;
}

/**
 * Zapisuje novu boju u istom sintaksnom obliku kao original, da izmenjeni CSS
 * ostane što bliži izvornom (HEX ostaje HEX, `rgba(…, …)` ostaje sa zarezima, itd.).
 * Imenovane boje postaju HEX; lab/lch/oklab/color() postaju oklch().
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
