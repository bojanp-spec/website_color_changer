import { readFileSync } from 'node:fs';
import { colorKey, createColorMapper, isColorProperty } from '@cc/core';
import type { PluginCreator } from 'postcss';

export interface CcRemapOptions {
  /**
   * An "old color → new color" map, or a path to the JSON produced by `cc-export --map`
   * (`{ "palette": {…}, "map": { "#1e3a8a": "#c62828", … } }`).
   */
  map: Record<string, string> | string;
  /** `like` (default) keeps the original notation (HEX stays HEX…); `hex` always writes HEX. */
  format?: 'like' | 'hex';
  /**
   * Local contrast fixes from the map (e.g. text on a CTA button: `a.btn-primary { color: … }`).
   * `append` adds them at the end of the file — enable it for one main stylesheet. Defaults to `ignore`
   * (with a warning if the map has any).
   */
  localRules?: 'append' | 'ignore';
  /** Message language: `en` or `sr`. Defaults from `CC_LANG`/`LC_ALL`/`LANG` (`sr*` → Serbian, otherwise English). */
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

/** Shorthands in source CSS that can contain a color (CSSOM expands them, source files don't). */
const COLOR_SHORTHANDS =
  /^(background|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?|border-color|border-image|outline|text-decoration|text-emphasis|column-rule|list-style|mask)$/i;

/** Variables: CSS (`--brand`), SCSS (`$brand`), Less (`@brand`). */
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
 * Phase 7: changes colors DIRECTLY in source CSS/SCSS files using the map from `cc-export`.
 * Only values of color-bearing declarations change; `url()`, strings, `var()`
 * references, selectors and other properties stay byte-identical.
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
