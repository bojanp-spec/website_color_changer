import { readFileSync } from 'node:fs';
import { colorKey, createColorMapper, isColorProperty } from '@cc/core';
import type { PluginCreator } from 'postcss';

export interface CcRemapOptions {
  /**
   * Mapa „stara boja → nova boja", ili putanja do JSON-a koji pravi `cc-export --map`
   * (`{ "palette": {…}, "map": { "#1e3a8a": "#c62828", … } }`).
   */
  map: Record<string, string> | string;
  /** `like` (podrazumevano) zadržava zapis originala (HEX ostaje HEX…); `hex` uvek piše HEX. */
  format?: 'like' | 'hex';
  /**
   * Lokalne korekcije kontrasta iz mape (npr. tekst na CTA dugmetu: `a.btn-primary { color: … }`).
   * `append` ih dodaje na kraj fajla — uključiti za jedan, glavni stylesheet. Podrazumevano `ignore`
   * (uz upozorenje ako ih mapa ima).
   */
  localRules?: 'append' | 'ignore';
  /** Jezik poruka: `en` ili `sr`. Podrazumevano iz `CC_LANG`/`LC_ALL`/`LANG` (`sr*` → srpski, inače engleski). */
  lang?: 'sr' | 'en';
}

const TEXT = {
  sr: {
    required: 'postcss-cc-remap: opcija `map` je obavezna',
    badColor: (from: string, to: string) => `postcss-cc-remap: nevalidna boja u mapi: "${from}" → "${to}"`,
    comment: 'cc-export: lokalna korekcija kontrasta',
    warnLocal: (n: number, example: string) =>
      `Mapa ima ${n} lokalnih korekcija kontrasta (npr. ${example}) — dodaj ih sa localRules: 'append' u glavni stylesheet.`,
  },
  en: {
    required: 'postcss-cc-remap: the `map` option is required',
    badColor: (from: string, to: string) => `postcss-cc-remap: invalid color in the map: "${from}" → "${to}"`,
    comment: 'cc-export: local contrast fix',
    warnLocal: (n: number, example: string) =>
      `The map has ${n} local contrast fixes (e.g. ${example}) — add them with localRules: 'append' in the main stylesheet.`,
  },
} as const;

function envLang(): 'sr' | 'en' {
  const env = typeof process !== 'undefined' ? process.env : {};
  return (env.CC_LANG || env.LC_ALL || env.LANG || '').toLowerCase().startsWith('sr') ? 'sr' : 'en';
}

/** Shorthand-ovi u izvornom CSS-u koji mogu da sadrže boju (CSSOM ih razbija, izvorni fajlovi ne). */
const COLOR_SHORTHANDS =
  /^(background|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?|border-color|border-image|outline|text-decoration|text-emphasis|column-rule|list-style|mask)$/i;

/** Varijable: CSS (`--brand`), SCSS (`$brand`), Less (`@brand`). */
const isVariable = (prop: string) => /^(--|\$|@)/.test(prop);

export function canHoldColor(prop: string): boolean {
  return isVariable(prop) || isColorProperty(prop) || COLOR_SHORTHANDS.test(prop);
}

function loadMap(map: CcRemapOptions['map'], T: (typeof TEXT)['en' | 'sr']): { colors: Map<string, string>; localRules: Record<string, string> } {
  const raw: unknown = typeof map === 'string' ? JSON.parse(readFileSync(map, 'utf8')) : map;
  const isExport = !!raw && typeof raw === 'object' && 'map' in raw;
  const entries = (isExport ? (raw as { map: unknown }).map : raw) as Record<string, string>;
  const localRules = (isExport ? (raw as { localRules?: Record<string, string> }).localRules : undefined) ?? {};
  const out = new Map<string, string>();
  for (const [from, to] of Object.entries(entries ?? {})) {
    const k = colorKey(from);
    const v = colorKey(to);
    if (!k || !v) throw new Error(T.badColor(from, to));
    out.set(k, v);
  }
  return { colors: out, localRules };
}

/**
 * Faza 7: menja boje DIREKTNO u izvornim CSS/SCSS fajlovima prema mapi iz `cc-export`.
 * Menjaju se samo vrednosti deklaracija koje nose boju; `url()`, stringovi, `var()`
 * reference, selektori i ostala svojstva ostaju bajt-identični.
 *
 * ```js
 * // postcss.config.js
 * import ccRemap from 'postcss-cc-remap';
 * export default { plugins: [ccRemap({ map: './paleta.map.json' })] };
 * ```
 */
const ccRemap: PluginCreator<CcRemapOptions> = (opts) => {
  const T = TEXT[opts?.lang ?? envLang()];
  if (!opts?.map) throw new Error(T.required);
  const { colors, localRules } = loadMap(opts.map, T);
  const mapper = createColorMapper(colors, { format: opts.format ?? 'like' });
  const locals = Object.entries(localRules);
  return {
    postcssPlugin: 'postcss-cc-remap',
    Once(root, { result }) {
      let changed = 0;
      root.walkDecls((decl) => {
        if (!canHoldColor(decl.prop)) return;
        const next = mapper.mapValue(decl.value);
        if (next !== decl.value) {
          decl.value = next;
          changed++;
        }
      });
      if (locals.length && opts.localRules === 'append') {
        root.append({ text: T.comment, raws: { before: '\n\n' } });
        for (const [selector, color] of locals) root.append({ selector, nodes: [{ prop: 'color', value: color } as never] });
      } else if (locals.length && opts.localRules !== 'ignore') {
        result.warn(T.warnLocal(locals.length, locals[0]![0]), { plugin: 'postcss-cc-remap' });
      }
      result.messages.push({ type: 'cc-remap', plugin: 'postcss-cc-remap', changed });
    },
  };
};
ccRemap.postcss = true;

export default ccRemap;
