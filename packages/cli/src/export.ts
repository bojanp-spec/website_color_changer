import { chromium } from '@playwright/test';
import { buildColorMap, buildOverrideCss, classify, contrastRatio, createColorMapper, isAltContext, parseColor } from '@cc/core';
import type { Classification, ColorMapResult, LocalContrastFix, Palette, Role, Usage } from '@cc/core';
import { openPage, localFixes, scanPage, verifyPage } from './browser.js';
import { messages } from './i18n.js';
import type { Lang } from './i18n.js';
import { crawlable, mergeScans } from './merge.js';
import type { ExportReport, PageScan } from './types.js';

export interface ExportOptions {
  /** Prva stranica; `pages` su putanje u odnosu na nju. */
  url: string;
  palette: Palette;
  pages?: string[];
  /** Ukupan broj stranica koje se obilaze praćenjem linkova (0 = samo zadate). */
  crawl?: number;
  viewports?: number[];
  overrides?: Record<string, Role>;
  /** Uključi i semantičke boje/grafikone u remapiranje. */
  allColors?: boolean;
  verify?: boolean;
  screenshots?: string;
  scroll?: boolean;
  wait?: number;
  /** Putanja do core IIFE bundle-a. */
  bundle: string;
  /** Jezik poruka i komentara u CSS-u. Podrazumevano `'en'`. */
  lang?: Lang;
  log?: (line: string) => void;
}

export interface ExportResult {
  css: string;
  /** Lokalne korekcije kontrasta kao CSS pravila: selektor → boja teksta. */
  localRules: Record<string, string>;
  colorMap: ColorMapResult;
  classification: Classification;
  report: ExportReport;
}

/**
 * Faza 7: izvoz za produkciju.
 * 1. Skenira sve stranice u svim prikazima (desktop/mobilni).
 * 2. Spaja nalaze i klasifikuje/mapira boje JEDNOM — ista mapa važi za ceo sajt.
 * 3. Na svakoj stranici primenjuje tu mapu da pokupi lokalne korekcije kontrasta (traže DOM).
 * 4. Pravi jedan CSS fajl, pa ga proverava na svakoj stranici bez engine-a.
 */
export async function exportSite(opts: ExportOptions): Promise<ExportResult> {
  const log = opts.log ?? (() => {});
  const M = messages(opts.lang ?? 'en');
  const viewports = opts.viewports?.length ? opts.viewports : [1440, 390];
  const start = new URL(opts.url);
  const queue = [start.toString(), ...(opts.pages ?? []).map((p) => new URL(p, start).toString())];
  const urls: string[] = [];
  for (const u of queue) if (!urls.includes(u)) urls.push(u);
  const maxPages = Math.max(urls.length, opts.crawl ?? 0);
  const load = { scroll: opts.scroll !== false, wait: opts.wait ?? 0 };

  const browser = await chromium.launch();
  // bypassCSP: core se ubacuje kao <script>, što bi stroga CSP sajta blokirala.
  const context = await browser.newContext({ bypassCSP: true, colorScheme: 'light' });
  try {
    // --- 1. Skeniranje
    const scans: PageScan[] = [];
    for (let i = 0; i < urls.length; i++) {
      for (const vp of viewports) {
        const page = await openPage(context, urls[i]!, { ...load, viewport: vp });
        const scan = await scanPage(page, opts.bundle, vp);
        scans.push(scan);
        log(M.scanned(scan.url, vp, scan.palette.length));
        if (vp === viewports[0] && urls.length < maxPages) {
          for (const href of scan.links) {
            const next = crawlable(href, start.origin);
            if (next && !urls.includes(next) && urls.length < maxPages) urls.push(next);
          }
        }
        await page.close();
      }
    }

    // --- 2. Zajednička klasifikacija i mapa
    const merged = mergeScans(scans);
    const classification = classify(merged, {
      ...(opts.overrides ? { overrides: opts.overrides } : {}),
      ...(opts.allColors ? { protectVariables: null } : {}),
    });
    const colorMap = buildColorMap(classification, opts.palette, merged.pairs);
    log(M.classified(classification.bases.dominant, classification.bases.secondary, classification.bases.accent ?? '—'));

    // --- 3. Lokalne korekcije (samo ako postoje parovi koje mapa ne rešava globalno)
    const fixes: LocalContrastFix[] = [];
    if (colorMap.failures.length) {
      for (const url of urls) {
        for (const vp of viewports) {
          const page = await openPage(context, url, { ...load, viewport: vp });
          for (const f of await localFixes(page, opts.bundle, opts.palette, colorMap)) {
            const same = fixes.find((x) => JSON.stringify(x.via) === JSON.stringify(f.via) && x.fg === f.fg && x.bg === f.bg);
            if (!same) fixes.push(f);
          }
          await page.close();
        }
      }
    }
    // Upozorenja o kontrastu samo za parove koje ni lokalna korekcija nije rešila.
    const fixed = new Set(fixes.map((f) => `${f.fg}|${f.bg}`));
    const rgba = (hex: string) => parseColor(hex)!.rgba;
    const warnings = colorMap.failures
      .filter((f) => !fixed.has(`${f.fg}|${f.bg}`))
      .map((f) => {
        const toFg = colorMap.map.get(f.fg) ?? f.fg;
        const toBg = colorMap.map.get(f.bg) ?? f.bg;
        return M.contrast(f.fg, f.bg, contrastRatio(rgba(toFg), rgba(toBg)).toFixed(2), f.target.toFixed(2), toFg, toBg);
      });
    const varOverrides = new Map<string, string>();
    /** Boja → selektori; ista korekcija sa više stranica postaje jedno pravilo. */
    const localRules = new Map<string, Set<string>>();
    for (const f of fixes) {
      if (f.via.kind === 'variable') varOverrides.set(f.via.name, f.to);
      else if (f.via.selector) {
        const set = localRules.get(f.to) ?? new Set<string>();
        for (const sel of f.via.selector.split(',')) set.add(sel.trim());
        localRules.set(f.to, set);
      } else warnings.push(M.noSelector(f.fg, f.bg, f.to, f.via.elements));
    }

    // --- 4. CSS
    const mapper = createColorMapper(colorMap.map, { format: 'hex' });
    const byScope = buildOverrideCss(merged.usages as Usage[], mapper, {
      varOverrides,
      isAlt: (u) => isAltContext(u, classification.light),
    });
    const shadowScopes = [...byScope.keys()].filter((k) => k);
    if (shadowScopes.length) warnings.push(M.shadow(shadowScopes.join(', ')));
    // Inline boje koje bi trebalo promeniti (zaštićene, npr. logo, se ne broje).
    const inlineCount = merged.usages.filter((u) => u.inline && u.colors.some((c) => mapper.mapKey(c))).length;
    if (inlineCount) warnings.push(M.inline(inlineCount));

    const body = byScope.get('') ?? '';
    const local = [...localRules].map(([color, sels]) => `${[...sels].join(',\n')} {\n  color: ${color};\n}`).join('\n');
    const css = [
      '/*',
      ' * Website Color Changer — theme-override.css',
      ` * ${M.cssPalette} ${opts.palette.dominant} (60%) / ${opts.palette.secondary} (30%) / ${opts.palette.accent} (10%)`,
      ` * ${M.cssSite} ${classification.bases.dominant} / ${classification.bases.secondary} / ${classification.bases.accent ?? '—'}`,
      ` * ${M.cssPages(urls.length)} ${urls.join(', ')}`,
      ` * ${M.cssAfter}`,
      ' */',
      body,
      local ? `\n/* ${M.cssLocal} */\n${local}` : '',
    ]
      .filter(Boolean)
      .join('\n')
      .concat('\n');
    const rules = (body.match(/\{\n {2}/g)?.length ?? 0) + localRules.size;

    // --- 5. Provera
    const verification = [];
    if (opts.verify !== false) {
      for (const url of urls) {
        for (const vp of viewports) {
          const page = await openPage(context, url, { ...load, viewport: vp });
          const shot = opts.screenshots ? `${opts.screenshots}/${slug(url)}@${vp}.png` : undefined;
          const v = await verifyPage(page, opts.bundle, css, colorMap.map, vp, shot);
          verification.push(v);
          log(M.verified(v.url, vp, v.contrastRegressions.length, v.uncovered.length));
          await page.close();
        }
      }
    }

    const report: ExportReport = {
      palette: opts.palette,
      pages: scans.map((s) => ({
        url: s.url,
        viewport: s.viewport,
        colors: s.palette.length,
        blockedSheets: s.sheets.filter((x) => x.status === 'blocked').map((x) => x.id),
      })),
      bases: classification.bases,
      rules,
      localFixes: fixes,
      warnings,
      verification,
    };
    const localRulesOut: Record<string, string> = {};
    for (const [color, sels] of localRules) for (const sel of sels) localRulesOut[sel] = color;
    return { css, localRules: localRulesOut, colorMap, classification, report };
  } finally {
    await browser.close();
  }
}

function slug(url: string): string {
  const u = new URL(url);
  return (u.hostname + u.pathname).replace(/[^\w.-]+/g, '_').replace(/_+$/, '') || 'index';
}
