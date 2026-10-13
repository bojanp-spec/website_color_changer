import { parseColor } from '../color/parse.js';
import { toHex } from '../color/serialize.js';
import { findColors } from '../color/tokenize.js';

/** Svojstva koja nose boju, a ne završavaju se na `color`. */
const EXTRA_COLOR_PROPS: ReadonlySet<string> = new Set([
  'background-image',
  'box-shadow',
  'text-shadow',
  'fill',
  'stroke',
  'filter', // drop-shadow(... color)
  'border-image-source',
  'list-style-image',
  'mask-image',
  'scrollbar-color',
]);

/** Svojstva koja se završavaju na `color`, ali nisu boje. */
const NOT_COLOR_PROPS: ReadonlySet<string> = new Set(['color-scheme', 'forced-color-adjust', 'print-color-adjust', 'color-interpolation', 'color-interpolation-filters', 'color-rendering']);

/**
 * Da li CSS svojstvo (longhand) može da sadrži boju. CSSOM razbija shorthand-ove
 * (`background`, `border`) na longhand-ove, pa je dovoljno pokriti njih.
 */
export function isColorProperty(prop: string): boolean {
  const p = prop.toLowerCase();
  if (NOT_COLOR_PROPS.has(p)) return false;
  return p === 'color' || p.endsWith('-color') || EXTRA_COLOR_PROPS.has(p);
}

/** SVG prezentacioni atributi koji nose boju. */
export const SVG_COLOR_ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color'] as const;

/** Zastareli HTML atributi koji nose boju (`<td bgcolor>`, `<font color>`, `<body text link>`). */
export const HTML_COLOR_ATTRS = ['bgcolor', 'color', 'text', 'link', 'vlink', 'alink'] as const;

/** Kanonski ključ boje: `#rrggbb` ili `#rrggbbaa` (mala slova, gamut-mapirano). */
export function colorKey(input: string): string | null {
  const parsed = parseColor(input);
  return parsed ? toHex(parsed.rgba) : null;
}

/** Konkretne boje u vrednosti, kao kanonski ključevi (bez duplikata, redosledom pojavljivanja). */
export function colorKeysIn(value: string): string[] {
  const keys = new Set<string>();
  for (const m of findColors(value)) if (m.color) keys.add(toHex(m.color.rgba));
  return [...keys];
}

/** Imena varijabli na koje vrednost upućuje: `var(--a, var(--b))` → `['--a', '--b']`. */
export function varRefsIn(value: string): string[] {
  const out = new Set<string>();
  for (const m of value.matchAll(/var\(\s*(--[\w-]+)/g)) if (m[1]) out.add(m[1]);
  return [...out];
}
