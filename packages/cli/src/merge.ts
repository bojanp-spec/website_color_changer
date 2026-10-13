import type { ColorWeight, ContrastPair, PaletteEntry, ScanSummary } from '@cc/core';
import type { PageScan, PlainUsage } from './types.js';

/** Declaration key: the same declaration from the same stylesheet on multiple pages counts once. */
function usageKey(u: PlainUsage): string {
  if (u.inline || u.selector === undefined) return JSON.stringify(['inline', u.source, u.property, u.value]);
  return JSON.stringify([u.scope ?? '', u.sheet ?? '', u.conditions, u.nesting ?? [], u.selector, u.property, u.value, u.important, u.ruleText ?? '']);
}

const WEIGHT_FIELDS = ['bgArea', 'textArea', 'borderArea', 'svgArea', 'interactiveArea'] as const;

export interface MergedScan extends ScanSummary {
  palette: PaletteEntry[];
  pairs: ContrastPair[];
  usages: PlainUsage[];
}

/**
 * Merges scans of multiple pages/viewports into one, as if the whole site were a single page:
 * - declarations: union, no duplicates, in order of first appearance (preserves the cascade);
 * - areas: each page/viewport is normalized to 1, so each has the same weight
 *   (a long home page doesn't "outvote" the others);
 * - text/background pairs: union, keeping the smallest font size and the "small text" flag.
 */
export function mergeScans(scans: PageScan[]): MergedScan {
  const usages: PlainUsage[] = [];
  const seen = new Set<string>();
  const palette = new Map<string, PaletteEntry>();
  const pairs = new Map<string, ContrastPair>();
  /** A color is "implicit" (the browser's default white) only if no page declares it. */
  const explicit = new Set<string>();

  for (const scan of scans) {
    for (const u of scan.usages) {
      const key = usageKey(u);
      if (seen.has(key)) continue;
      seen.add(key);
      usages.push(u);
    }

    const total = scan.palette.reduce((n, e) => n + e.area, 0) || 1;
    for (const e of scan.palette) {
      const m = palette.get(e.key) ?? {
        key: e.key,
        area: 0,
        share: 0,
        weight: { key: e.key, bgArea: 0, textArea: 0, borderArea: 0, svgArea: 0, interactiveArea: 0, elementCount: 0 } as ColorWeight,
        declared: {},
        variables: [],
      };
      m.area += e.area / total;
      for (const f of WEIGHT_FIELDS) m.weight[f] += e.weight[f] / total;
      m.weight.elementCount += e.weight.elementCount;
      if (!e.weight.implicit) explicit.add(e.key);
      for (const [src, n] of Object.entries(e.declared)) m.declared[src as keyof PaletteEntry['declared']] = (m.declared[src as keyof PaletteEntry['declared']] ?? 0) + (n ?? 0);
      for (const v of e.variables) if (!m.variables.includes(v)) m.variables.push(v);
      palette.set(e.key, m);
    }

    const pairTotal = scan.pairs.reduce((n, p) => n + p.weight, 0) || 1;
    for (const p of scan.pairs) {
      const key = `${p.fg}|${p.bg}`;
      const m = pairs.get(key);
      if (m) {
        m.weight += p.weight / pairTotal;
        m.minFontSize = Math.min(m.minFontSize, p.minFontSize);
        m.hasSmallText ||= p.hasSmallText;
      } else {
        pairs.set(key, { ...p, weight: p.weight / pairTotal });
      }
    }
  }

  const list = [...palette.values()];
  for (const e of list) {
    if (explicit.has(e.key)) delete e.weight.implicit;
    else e.weight.implicit = true;
  }
  const total = list.reduce((n, e) => n + e.area, 0) || 1;
  for (const e of list) e.share = e.area / total;
  list.sort((a, b) => b.area - a.area);
  return { usages, palette: list, pairs: [...pairs.values()].sort((a, b) => b.weight - a.weight) };
}

/** Links for --crawl: same domain, http(s), no files (pdf, images…), no #fragment. */
export function crawlable(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.origin !== origin || !/^https?:$/.test(url.protocol)) return null;
  if (/\.(pdf|zip|rar|7z|jpe?g|png|gif|webp|avif|svg|ico|mp4|webm|mp3|wav|docx?|xlsx?|pptx?|csv|json|xml|txt)$/i.test(url.pathname)) return null;
  url.hash = '';
  return url.toString();
}
