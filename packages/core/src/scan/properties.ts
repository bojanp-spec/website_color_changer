import { parseColor } from '../color/parse.js';
import { toHex } from '../color/serialize.js';
import { findColors } from '../color/tokenize.js';

/** Properties that carry a color but do not end in `color`. */
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

/** Properties that end in `color` but are not colors. */
const NOT_COLOR_PROPS: ReadonlySet<string> = new Set(['color-scheme', 'forced-color-adjust', 'print-color-adjust', 'color-interpolation', 'color-interpolation-filters', 'color-rendering']);

/**
 * Whether a CSS property (longhand) can contain a color. CSSOM expands shorthands
 * (`background`, `border`) into longhands, so covering those is enough.
 */
export function isColorProperty(prop: string): boolean {
  const p = prop.toLowerCase();
  if (NOT_COLOR_PROPS.has(p)) return false;
  return p === 'color' || p.endsWith('-color') || EXTRA_COLOR_PROPS.has(p);
}

/** SVG presentation attributes that carry a color. */
export const SVG_COLOR_ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color'] as const;

/** Legacy HTML attributes that carry a color (`<td bgcolor>`, `<font color>`, `<body text link>`). */
export const HTML_COLOR_ATTRS = ['bgcolor', 'color', 'text', 'link', 'vlink', 'alink'] as const;

/** Canonical color key: `#rrggbb` or `#rrggbbaa` (lowercase, gamut-mapped). */
export function colorKey(input: string): string | null {
  const parsed = parseColor(input);
  return parsed ? toHex(parsed.rgba) : null;
}

/** Concrete colors in the value, as canonical keys (deduplicated, in order of appearance). */
export function colorKeysIn(value: string): string[] {
  const keys = new Set<string>();
  for (const m of findColors(value)) if (m.color) keys.add(toHex(m.color.rgba));
  return [...keys];
}

/** Names of variables the value references: `var(--a, var(--b))` → `['--a', '--b']`. */
export function varRefsIn(value: string): string[] {
  const out = new Set<string>();
  for (const m of value.matchAll(/var\(\s*(--[\w-]+)/g)) if (m[1]) out.add(m[1]);
  return [...out];
}
