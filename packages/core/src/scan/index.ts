import { scanStylesheets } from './cssom-scanner.js';
import type { CssomScanOptions } from './cssom-scanner.js';
import { scanInline } from './inline-scanner.js';
import { weighByArea } from './area-weigher.js';
import type { ColorWeight, PaletteEntry, ScanResult, SheetReport, Usage } from './types.js';

export interface ScanOptions extends CssomScanOptions {
  /** Skenira i otvorene shadow root-ove web komponenti. Podrazumevano `true`. */
  shadowRoots?: boolean;
}

function* openShadowRoots(root: Document | ShadowRoot): Generator<ShadowRoot> {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.shadowRoot && !el.closest('[data-cc]')) {
      yield el.shadowRoot;
      yield* openShadowRoots(el.shadowRoot);
    }
  }
}

/** Faza 1: pronalazi sve deklarisane boje sajta i meri njihovu vidljivu površinu. Ne menja stranicu. */
export async function scanDocument(doc: Document, opts: ScanOptions = {}): Promise<ScanResult> {
  const t0 = performance.now();
  const usages: Usage[] = [];
  const sheets: SheetReport[] = [];

  const roots: { root: Document | ShadowRoot; prefix: string }[] = [{ root: doc, prefix: '' }];
  if (opts.shadowRoots !== false) {
    let i = 0;
    for (const sr of openShadowRoots(doc)) roots.push({ root: sr, prefix: `${sr.host.localName}#${i++}>` });
  }

  for (const { root, prefix } of roots) {
    const css = await scanStylesheets(root, { ...opts, idPrefix: prefix });
    usages.push(...css.usages, ...scanInline(root));
    sheets.push(...css.sheets);
  }

  const { weights, pairs, elements } = weighByArea(doc);
  const palette = buildPalette(usages, weights);
  return {
    usages,
    sheets,
    weights,
    pairs: pairs.sort((a, b) => b.weight - a.weight),
    palette,
    stats: {
      elements,
      rules: sheets.reduce((n, s) => n + s.ruleCount, 0),
      durationMs: Math.round(performance.now() - t0),
    },
  };
}

const visibleArea = (w: ColorWeight) => w.bgArea + w.textArea + w.borderArea + w.svgArea;

/**
 * Spaja deklaracije i izmerene površine u jednu listu boja, sortiranu po vidljivoj površini.
 * Boje koje su deklarisane, a trenutno se ne vide (`:hover`, `@media`, modali), su na kraju sa area = 0.
 */
export function buildPalette(usages: Usage[], weights: ColorWeight[]): PaletteEntry[] {
  const byKey = new Map<string, PaletteEntry>();
  const entry = (key: string): PaletteEntry => {
    let e = byKey.get(key);
    if (!e) {
      e = {
        key,
        area: 0,
        share: 0,
        weight: { key, bgArea: 0, textArea: 0, borderArea: 0, svgArea: 0, interactiveArea: 0, elementCount: 0 },
        declared: {},
        variables: [],
      };
      byKey.set(key, e);
    }
    return e;
  };

  for (const w of weights) {
    const e = entry(w.key);
    e.weight = w;
    e.area = visibleArea(w);
  }
  for (const u of usages) {
    for (const key of u.colors) {
      const e = entry(key);
      e.declared[u.source] = (e.declared[u.source] ?? 0) + 1;
      if (u.source === 'variable' && !e.variables.includes(u.property)) e.variables.push(u.property);
    }
  }

  const total = [...byKey.values()].reduce((n, e) => n + e.area, 0) || 1;
  const list = [...byKey.values()];
  for (const e of list) e.share = e.area / total;
  const declaredCount = (e: PaletteEntry) => Object.values(e.declared).reduce((n, v) => n + (v ?? 0), 0);
  return list.sort((a, b) => b.area - a.area || declaredCount(b) - declaredCount(a));
}

export { scanStylesheets, defaultFetchCss } from './cssom-scanner.js';
export type { CssFetcher, CssomScanOptions } from './cssom-scanner.js';
export { scanInline } from './inline-scanner.js';
export { INTERACTIVE_SELECTOR, weighByArea } from './area-weigher.js';
export type { WeighResult } from './area-weigher.js';
export { colorKey, colorKeysIn, isColorProperty, varRefsIn } from './properties.js';
export { formatPalette, printPalette } from './report.js';
export type * from './types.js';
