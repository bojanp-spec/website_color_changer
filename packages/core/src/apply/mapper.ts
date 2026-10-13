import { deltaEOK } from '../color/convert.js';
import { parseColor } from '../color/parse.js';
import { formatLike, toHex } from '../color/serialize.js';
import { replaceColors } from '../color/tokenize.js';

/** Colors closer than this to a known color are mapped like that color (e.g. CSS rounding). */
const NEAREST_DELTA = 0.02;

export interface ColorMapper {
  /** New color for a canonical key, or `undefined` if the color does not change. */
  mapKey(key: string): string | undefined;
  /** CSS property value with colors replaced (the rest of the value untouched). */
  mapValue(value: string): string;
  /** Set of new colors (keys) — so an already replaced color is not changed again. */
  readonly targets: ReadonlySet<string>;
}

/**
 * Builds a mapping function from an "old → new" table. Colors that were not in the analysis
 * (e.g. styles loaded later) are mapped like the nearest known color if practically identical.
 */
export interface ColorMapperOptions {
  /** `like` = keep the original notation (default); `hex` = always `#rrggbb(aa)` (more readable in exported CSS). */
  format?: 'like' | 'hex';
}

export function createColorMapper(map: ReadonlyMap<string, string>, opts: ColorMapperOptions = {}): ColorMapper {
  const known = [...map.keys()].map((k) => ({ key: k, rgba: parseColor(k)!.rgba }));
  const cache = new Map<string, string | undefined>();
  const targets = new Set(map.values());

  const mapKey = (key: string): string | undefined => {
    if (cache.has(key)) return cache.get(key);
    let to = map.get(key);
    if (to === undefined) {
      const rgba = parseColor(key)?.rgba;
      if (rgba) {
        let best: { key: string; d: number } | undefined;
        for (const k of known) {
          if (Math.abs(k.rgba.a - rgba.a) > 0.01) continue;
          const d = deltaEOK(k.rgba, rgba);
          if (d < NEAREST_DELTA && (!best || d < best.d)) best = { key: k.key, d };
        }
        if (best) to = map.get(best.key);
      }
    }
    const result = to === key ? undefined : to;
    cache.set(key, result);
    return result;
  };

  const mapValue = (value: string): string =>
    replaceColors(value, (color) => {
      const to = mapKey(toHex(color.rgba));
      if (!to) return null;
      return opts.format === 'hex' ? to : formatLike(color, parseColor(to)!.rgba);
    });

  return { mapKey, mapValue, targets };
}
