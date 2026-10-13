import {
  displayP3ToRgb,
  hslToRgb,
  hwbToRgb,
  labToRgb,
  lchToRgb,
  linearSrgbToRgb,
  oklabToRgb,
  oklchToRgb,
  xyzD50ToRgb,
  xyzD65ToRgb,
} from './convert.js';
import { NAMED_COLORS } from './named.js';
import type { ColorFormat, RGBA } from './types.js';

export interface ParsedColor {
  rgba: RGBA;
  format: ColorFormat;
  /** rgb()/hsl() napisan starom sintaksom sa zarezima: `rgb(1, 2, 3)`. */
  legacy?: boolean;
  /** HEX napisan velikim slovima: `#1E3A8A`. */
  upper?: boolean;
  /** Originalni tekst, bajt-identičan. */
  source: string;
}

/** Ključne reči koje jesu „boje", ali se nikad ne remapiraju (prilagođavaju se same). */
export const PASSTHROUGH_KEYWORDS: ReadonlySet<string> = new Set(['transparent', 'currentcolor']);

const COLOR_FUNCTIONS: ReadonlySet<string> = new Set([
  'rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color',
]);

export function isColorFunctionName(name: string): boolean {
  return COLOR_FUNCTIONS.has(name.toLowerCase());
}

export function isNamedColor(name: string): boolean {
  return NAMED_COLORS.has(name.toLowerCase());
}

/**
 * Parsira jednu CSS boju. Vraća `null` za sve što nije konkretna boja koju možemo
 * izračunati: `transparent`, `currentColor`, `var(...)`, `calc(...)`, relativne boje
 * (`rgb(from ...)`), sistemske boje, nevalidan unos.
 */
export function parseColor(input: string): ParsedColor | null {
  const source = input;
  const str = input.trim();
  if (!str) return null;

  if (str[0] === '#') return parseHex(str, source);

  const lower = str.toLowerCase();
  const named = NAMED_COLORS.get(lower);
  if (named) {
    const hex = parseHex(`#${named}`, source);
    return hex && { ...hex, format: 'named', upper: false };
  }

  const open = str.indexOf('(');
  if (open <= 0 || str[str.length - 1] !== ')') return null;
  const fn = lower.slice(0, open);
  if (!COLOR_FUNCTIONS.has(fn)) return null;
  const body = str.slice(open + 1, -1);
  // Ugnježdene funkcije (var, calc, env, attr...) ne možemo statički da izračunamo.
  if (body.includes('(')) return null;

  const args = splitArgs(body);
  if (!args) return null;

  switch (fn) {
    case 'rgb':
    case 'rgba':
      return withMeta(parseRgb(args), 'rgb', args, source);
    case 'hsl':
    case 'hsla':
      return withMeta(parseHsl(args), 'hsl', args, source);
    case 'hwb':
      return args.legacy ? null : withMeta(parseHwb(args), 'hwb', args, source);
    case 'lab':
    case 'lch':
    case 'oklab':
    case 'oklch':
      return args.legacy ? null : withMeta(parseLabLike(fn, args), fn, args, source);
    case 'color':
      return args.legacy ? null : withMeta(parseColorFn(args), 'color', args, source);
  }
  return null;
}

function withMeta(
  rgba: RGBA | null,
  format: ColorFormat,
  args: Args,
  source: string,
): ParsedColor | null {
  if (!rgba) return null;
  return args.legacy ? { rgba, format, legacy: true, source } : { rgba, format, source };
}

// ---------------------------------------------------------------------------
// HEX
// ---------------------------------------------------------------------------

function parseHex(str: string, source: string): ParsedColor | null {
  const hex = str.slice(1);
  if (!/^[0-9a-f]+$/i.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return null;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
  const byte = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
  const rgba = { r: byte(0), g: byte(2), b: byte(4), a: full.length === 8 ? byte(6) : 1 };
  const upper = /[A-F]/.test(hex) && !/[a-f]/.test(hex);
  return { rgba, format: 'hex', upper, source };
}

// ---------------------------------------------------------------------------
// Argumenti
// ---------------------------------------------------------------------------

interface Args {
  /** Tri (ili za color() četiri — prostor + 3) glavne komponente. */
  parts: string[];
  alpha: string | undefined;
  legacy: boolean;
}

function splitArgs(body: string): Args | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  if (trimmed.includes(',')) {
    if (trimmed.includes('/')) return null;
    const parts = trimmed.split(',').map((p) => p.trim());
    if (parts.some((p) => !p || /\s/.test(p))) return null;
    if (parts.length !== 3 && parts.length !== 4) return null;
    return { parts: parts.slice(0, 3), alpha: parts[3], legacy: true };
  }
  const [main = '', alpha, ...rest] = trimmed.split('/');
  if (rest.length) return null;
  const parts = main.trim().split(/\s+/).filter(Boolean);
  if (alpha !== undefined && !alpha.trim()) return null;
  return { parts, alpha: alpha?.trim(), legacy: false };
}

const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/** Broj ili procenat. `percentScale` je vrednost koju predstavlja 100%. */
function num(token: string | undefined, percentScale: number, allowNone = true): number | null {
  if (token === undefined) return null;
  const t = token.toLowerCase();
  if (t === 'none') return allowNone ? 0 : null;
  if (t.endsWith('%')) {
    const n = t.slice(0, -1);
    return NUM.test(n) ? (parseFloat(n) / 100) * percentScale : null;
  }
  return NUM.test(t) ? parseFloat(t) : null;
}

/** Samo procenat (stara hsl sintaksa); vraća vrednost u 0..100. */
function percentOnly(token: string | undefined): number | null {
  if (token === undefined || !token.endsWith('%')) return null;
  return num(token, 100, false);
}

const ANGLE_UNITS: Record<string, number> = {
  deg: 1,
  grad: 360 / 400,
  rad: 180 / Math.PI,
  turn: 360,
};

function hue(token: string | undefined): number | null {
  if (token === undefined) return null;
  const t = token.toLowerCase();
  if (t === 'none') return 0;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/.exec(t);
  if (!m || m[1] === undefined) return null;
  return parseFloat(m[1]) * (m[2] ? (ANGLE_UNITS[m[2]] ?? 1) : 1);
}

function alphaOf(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const a = num(token, 1);
  return a === null ? null : Math.min(1, Math.max(0, a));
}

function allNumbers(values: (number | null)[]): values is number[] {
  return values.every((v) => v !== null && Number.isFinite(v));
}

// ---------------------------------------------------------------------------
// Pojedinačne funkcije
// ---------------------------------------------------------------------------

function parseRgb({ parts, alpha, legacy }: Args): RGBA | null {
  if (parts.length !== 3) return null;
  let channels: (number | null)[];
  if (legacy) {
    // Stara sintaksa: sve tri komponente su ili brojevi ili procenti, bez `none`.
    const pct = parts.every((p) => p.endsWith('%'));
    const nums = parts.every((p) => !p.endsWith('%'));
    if (!pct && !nums) return null;
    channels = parts.map((p) => num(p, 255, false));
  } else {
    channels = parts.map((p) => num(p, 255));
  }
  const a = alphaOf(alpha);
  if (!allNumbers(channels) || a === null) return null;
  const [r, g, b] = channels.map((c) => Math.min(255, Math.max(0, c)) / 255) as [number, number, number];
  return { r, g, b, a };
}

function parseHsl({ parts, alpha, legacy }: Args): RGBA | null {
  if (parts.length !== 3) return null;
  const h = hue(parts[0]);
  const [s, l] = legacy
    ? [percentOnly(parts[1]), percentOnly(parts[2])]
    : [num(parts[1], 100), num(parts[2], 100)];
  const a = alphaOf(alpha);
  if (h === null || s === null || l === null || a === null) return null;
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const lig = Math.min(100, Math.max(0, l)) / 100;
  return hslToRgb(h, sat, lig, a);
}

function parseHwb({ parts, alpha }: Args): RGBA | null {
  if (parts.length !== 3) return null;
  const h = hue(parts[0]);
  const w = num(parts[1], 100);
  const b = num(parts[2], 100);
  const a = alphaOf(alpha);
  if (h === null || w === null || b === null || a === null) return null;
  const clamp = (v: number) => Math.min(100, Math.max(0, v)) / 100;
  return hwbToRgb(h, clamp(w), clamp(b), a);
}

function parseLabLike(fn: 'lab' | 'lch' | 'oklab' | 'oklch', { parts, alpha }: Args): RGBA | null {
  if (parts.length !== 3) return null;
  const a = alphaOf(alpha);
  if (a === null) return null;
  const [p0, p1, p2] = parts;
  switch (fn) {
    case 'lab': {
      const v = [num(p0, 100), num(p1, 125), num(p2, 125)];
      if (!allNumbers(v)) return null;
      return labToRgb(Math.min(100, Math.max(0, v[0]!)), v[1]!, v[2]!, a);
    }
    case 'lch': {
      const v = [num(p0, 100), num(p1, 150), hue(p2)];
      if (!allNumbers(v)) return null;
      return lchToRgb(Math.min(100, Math.max(0, v[0]!)), Math.max(0, v[1]!), v[2]!, a);
    }
    case 'oklab': {
      const v = [num(p0, 1), num(p1, 0.4), num(p2, 0.4)];
      if (!allNumbers(v)) return null;
      return oklabToRgb({ l: Math.min(1, Math.max(0, v[0]!)), a: v[1]!, b: v[2]!, alpha: a });
    }
    case 'oklch': {
      const v = [num(p0, 1), num(p1, 0.4), hue(p2)];
      if (!allNumbers(v)) return null;
      return oklchToRgb({ l: Math.min(1, Math.max(0, v[0]!)), c: Math.max(0, v[1]!), h: v[2]!, a });
    }
  }
}

function parseColorFn({ parts, alpha }: Args): RGBA | null {
  if (parts.length !== 4) return null;
  const [space = '', ...comps] = parts;
  const v = comps.map((c) => num(c, 1));
  const a = alphaOf(alpha);
  if (!allNumbers(v) || a === null) return null;
  const [x, y, z] = v as [number, number, number];
  switch (space.toLowerCase()) {
    case 'srgb':
      return { r: x, g: y, b: z, a };
    case 'srgb-linear':
      return linearSrgbToRgb(x, y, z, a);
    case 'display-p3':
      return displayP3ToRgb(x, y, z, a);
    case 'xyz':
    case 'xyz-d65':
      return xyzD65ToRgb(x, y, z, a);
    case 'xyz-d50':
      return xyzD50ToRgb(x, y, z, a);
    default:
      return null;
  }
}
