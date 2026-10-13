import { deltaEOK } from '../color/convert.js';
import { parseColor } from '../color/parse.js';
import { formatLike, toHex } from '../color/serialize.js';
import { replaceColors } from '../color/tokenize.js';

/** Boje bliže od ovoga nekoj poznatoj boji mapiraju se kao ta boja (npr. zaokruživanje u CSS-u). */
const NEAREST_DELTA = 0.02;

export interface ColorMapper {
  /** Nova boja za kanonski ključ, ili `undefined` ako se boja ne menja. */
  mapKey(key: string): string | undefined;
  /** Vrednost CSS svojstva sa zamenjenim bojama (ostatak vrednosti netaknut). */
  mapValue(value: string): string;
  /** Skup novih boja (ključevi) — da se već zamenjena boja ne bi menjala ponovo. */
  readonly targets: ReadonlySet<string>;
}

/**
 * Pravi funkciju mapiranja iz tabele „stara → nova". Boje koje nisu bile u analizi
 * (npr. stilovi učitani kasnije) mapiraju se kao najbliža poznata boja ako je praktično ista.
 */
export interface ColorMapperOptions {
  /** `like` = zadrži zapis originala (podrazumevano); `hex` = uvek `#rrggbb(aa)` (čitljivije u izvezenom CSS-u). */
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
