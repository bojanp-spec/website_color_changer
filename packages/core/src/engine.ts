import { classify, isAltContext } from './analyze/classify.js';
import type { ClassifyOptions } from './analyze/classify.js';
import type { Classification, Palette, Role } from './analyze/types.js';
import { createColorMapper } from './apply/mapper.js';
import type { ColorMapper } from './apply/mapper.js';
import { DomPatcher } from './apply/dom-patcher.js';
import { buildOverrideCss } from './apply/override-sheet.js';
import { ensureContrast } from './color/contrast.js';
import { parseColor } from './color/parse.js';
import { toHex } from './color/serialize.js';
import { coreText } from './i18n.js';
import type { Lang } from './i18n.js';
import { buildColorMap } from './map/color-map.js';
import type { ColorMapOptions, ColorMapResult } from './map/color-map.js';
import { scanStylesheets } from './scan/cssom-scanner.js';
import { scanInline } from './scan/inline-scanner.js';
import { scanDocument } from './scan/index.js';
import type { ScanOptions } from './scan/index.js';
import { colorKey } from './scan/properties.js';
import type { ScanResult, Usage } from './scan/types.js';

export interface EngineOptions extends ScanOptions, ClassifyOptions, ColorMapOptions {
  /** Language of comments in the exported CSS, contrast warnings, reasons in the color map and errors. Default `'sr'`. */
  lang?: Lang;
  /** Track dynamic content (SPA, modals, lazy load, CSS-in-JS). Default `true`. */
  observe?: boolean;
  /** Disables CSS transitions while switching so the change does not "animate". Default `true`. */
  suppressTransitions?: boolean;
}

export interface LocalContrastFix {
  fg: string;
  bg: string;
  to: string;
  /**
   * `variable` = only that variable was changed (e.g. `--accent-contrast`); `inline` = color set on the elements.
   * For `inline`, `selector` is a verified CSS selector matching only those elements (or elements on the same
   * background) — so the exported CSS can cover the fix without inline attributes.
   */
  via: { kind: 'variable'; name: string } | { kind: 'inline'; elements: number; selector?: string };
}

export interface ApplyOptions {
  /** A ready-made color map (e.g. shared site-wide, from a CLI export) instead of computing one for this page. */
  colorMap?: ColorMapResult;
}

export interface ApplyReport {
  colorMap: ColorMapResult;
  /** Number of CSS rules in the layer (across all scopes). */
  rules: number;
  /** Number of elements whose attributes (style/fill/bgcolor) were temporarily changed. */
  patchedElements: number;
  localContrastFixes: LocalContrastFix[];
  /** Elements colored via the computed-style fallback (cross-origin styles without CORS). */
  fallbackPatched: number;
}

export interface ColorEngine {
  analyze(): Promise<{ scan: ScanResult; classification: Classification }>;
  /** Manual color role override; takes effect from the next `apply`. */
  setRoleOverride(key: string, role: Role): void;
  apply(palette: Palette, options?: ApplyOptions): ApplyReport;
  /** Restores the site to its original (no reload). The palette stays remembered for `toggle()`. */
  disable(): void;
  /** A/B: original ↔ last palette. Returns whether the palette is now applied. */
  toggle(): boolean;
  /** CSS for permanent use (document). */
  exportCss(): string;
  destroy(): void;
  readonly applied: boolean;
  readonly palette: Palette | null;
  /** Current classification (with manual overrides), after `analyze()`. */
  readonly classification: Classification | null;
}

/** Comments in the CSS exported by `exportCss()`. */
const EXPORT_TEXT = {
  sr: {
    palette: 'paleta',
    after: 'Dodati POSLE postojećih stilova sajta.',
    inline: (n: number) => `Napomena: ${n} boja je u inline style/SVG atributima — njih CSS fajl ne pokriva.`,
    manual: (fg: string, bg: string, to: string, n: number) =>
      `Lokalni kontrast: tekst ${fg} na ${bg} treba da bude ${to} na ${n} elemenata (npr. CTA dugmad) — dodati pravilo za njih ručno.`,
    local: 'Lokalna korekcija kontrasta (npr. tekst na CTA dugmadi)',
  },
  en: {
    palette: 'palette',
    after: "Include AFTER the site's existing styles.",
    inline: (n: number) => `Note: ${n} colors are in inline style/SVG attributes — this CSS file does not cover them.`,
    manual: (fg: string, bg: string, to: string, n: number) =>
      `Local contrast: text ${fg} on ${bg} should be ${to} on ${n} elements (e.g. CTA buttons) — add a rule for them manually.`,
    local: 'Local contrast fix (e.g. text on CTA buttons)',
  },
} as const;

const MARK = '__cc';
type MarkedSheet = CSSStyleSheet & { [MARK]?: boolean };

const SVG_NS = 'http://www.w3.org/2000/svg';
const OBSERVED_ATTRS = ['style', 'fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color', 'bgcolor', 'text', 'link', 'vlink', 'alink'];
const FALLBACK_PROPS = [
  'color',
  'background-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
  'fill',
  'stroke',
];

function markedSheet(doc: Document, css: string): MarkedSheet {
  const view = doc.defaultView ?? window;
  const sheet = new view.CSSStyleSheet() as MarkedSheet;
  sheet.replaceSync(css);
  sheet[MARK] = true;
  return sheet;
}

/**
 * Public API: scan → classify → apply the palette as a non-destructive layer.
 *
 * ```js
 * const engine = createEngine(document);
 * await engine.analyze();
 * engine.apply({ dominant: '#FAFAFA', secondary: '#4B4B4F', accent: '#D32F2F' });
 * engine.toggle(); // original
 * ```
 */
export function createEngine(doc: Document = document, opts: EngineOptions = {}): ColorEngine {
  const view = doc.defaultView ?? window;
  const overrides: Record<string, Role> = { ...(opts.overrides ?? {}) };
  let scan: ScanResult | null = null;
  let classification: Classification | null = null;
  let palette: Palette | null = null;
  let applied = false;

  // State of a single apply
  let mapper: ColorMapper | null = null;
  let varOverrides = new Map<string, string>();
  let lastLocalFixes: LocalContrastFix[] = [];
  let lastColorMap: ColorMapResult | null = null;
  let cssByScope = new Map<string, string>();
  const installed = new Map<Document | ShadowRoot, MarkedSheet>();
  const patcher = new DomPatcher();
  let observer: MutationObserver | null = null;
  let rescanTimer: ReturnType<typeof setTimeout> | null = null;

  const rootFor = (scope: string): Document | ShadowRoot | undefined => (scope ? scan?.scopes.get(scope) : doc);
  const isAlt = (u: Usage) => !!classification && isAltContext(u, classification.light);

  function install(scope: string, css: string) {
    const root = rootFor(scope);
    if (!root) return;
    const existing = installed.get(root);
    if (existing) {
      existing.replaceSync(css);
      return;
    }
    const sheet = markedSheet(doc, css);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    installed.set(root, sheet);
  }

  function uninstall() {
    for (const [root, sheet] of installed) root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== sheet);
    installed.clear();
  }

  function suppressTransitions() {
    if (opts.suppressTransitions === false) return;
    const sheet = markedSheet(doc, '*, *::before, *::after { transition: none !important; }');
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    // Two frames: the style is applied without transitions, then transitions are restored.
    view.requestAnimationFrame(() =>
      view.requestAnimationFrame(() => {
        doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet);
      }),
    );
  }

  /** Inline `style`, SVG and HTML color attributes. */
  function patchInline(usages: Usage[]) {
    if (!mapper) return;
    for (const u of usages) {
      const el = u.element;
      if (!el) continue;
      const value = mapper.mapValue(u.value);
      if (value === u.value) continue;
      if (u.source === 'inline' || u.source === 'variable') {
        patcher.setStyle(el as HTMLElement, u.property, value, u.important);
      } else {
        patcher.setAttr(el, u.property, value);
      }
    }
  }

  /** Styles we cannot read (CORS): colors from the computed style, applied inline. */
  function patchComputedFallback(): number {
    if (!mapper || !scan?.sheets.some((s) => s.status === 'blocked')) return 0;
    let count = 0;
    const roots: (Document | ShadowRoot)[] = [doc, ...(scan.scopes.values() ?? [])];
    for (const root of roots) {
      for (const el of Array.from(root.querySelectorAll<HTMLElement | SVGElement>('*'))) {
        if (el.closest('[data-cc]')) continue;
        const cs = view.getComputedStyle(el);
        let touched = false;
        for (const prop of FALLBACK_PROPS) {
          if (patcher.hasStyle(el, prop)) continue;
          const key = colorKey(cs.getPropertyValue(prop));
          if (!key || mapper.targets.has(key)) continue;
          const to = mapper.mapKey(key);
          if (!to) continue;
          patcher.setStyle(el, prop, to);
          touched = true;
        }
        if (touched) count++;
      }
    }
    return count;
  }

  function conditionsActive(conditions: string[]): boolean {
    return conditions.every((c) => {
      try {
        if (c.startsWith('@media ')) return view.matchMedia(c.slice(7)).matches;
        if (c.startsWith('@supports ')) return view.CSS.supports(c.slice(10));
      } catch {
        return true;
      }
      return true;
    });
  }

  /**
   * The variable from which the element (or the nearest ancestor with a rule) takes its text color — only if
   * that actually holds in the cascade (the rule may be overridden, e.g. `a { color: inherit }` outside layers).
   */
  function colorVariableFor(el: Element): string | null {
    const found = colorRuleFor(el);
    return found && variableControlsColor(found.node, found.name) ? found.name : null;
  }

  /**
   * Probe: set the variable on the element and check whether the text color changes; restore the original right away.
   * Uses a temporary attribute and layer, not `el.style` — after a CSSOM change to the inline style
   * Chrome may leave an empty `style=""`, so the DOM would not be identical to the original.
   */
  function variableControlsColor(node: Element, name: string): boolean {
    const probe = markedSheet(doc, `[data-cc-probe] { ${name}: #010203 !important; }`);
    const root = node.getRootNode() as Document | ShadowRoot;
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, probe];
    node.setAttribute('data-cc-probe', '');
    try {
      return colorKey(view.getComputedStyle(node).color) === '#010203';
    } finally {
      node.removeAttribute('data-cc-probe');
      root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== probe);
    }
  }

  function colorRuleFor(el: Element): { node: Element; name: string } | null {
    if (!scan) return null;
    const rules = scan.usages.filter(
      (u) => u.source === 'cssom' && u.property === 'color' && u.varRefs.length && !u.nesting && !u.ruleText && !u.scope && conditionsActive(u.conditions),
    );
    for (let node: Element | null = el; node; node = node.parentElement) {
      let match: Usage | undefined;
      for (const u of rules) {
        try {
          if (node.matches(u.selector!)) match = u;
        } catch {
          /* selector the browser does not support in matches() */
        }
      }
      if (match?.varRefs[0]) return { node, name: match.varRefs[0] };
    }
    return null;
  }

  /**
   * Pairs that cannot be fixed globally (e.g. text on a CTA button shares its color with the main
   * text): fix only where the pair occurs — via a separate variable if safe,
   * otherwise inline on those elements. The reverse direction is allowed here too (dark → white text on a button).
   */
  function planLocalContrast(map: ColorMapResult): { fixes: LocalContrastFix[]; inline: [Element, string][] } {
    const fixes: LocalContrastFix[] = [];
    const inline: [Element, string][] = [];
    if (!scan) return { fixes, inline };
    for (const f of map.failures) {
      const elements = scan.pairElements.get(`${f.fg}|${f.bg}`) ?? [];
      const fg = parseColor(map.map.get(f.fg) ?? f.fg)?.rgba;
      const bg = parseColor(map.map.get(f.bg) ?? f.bg)?.rgba;
      if (!elements.length || !fg || !bg) continue;
      const fix = ensureContrast(fg, bg, f.target);
      if (!fix.reached) continue;
      const to = toHex(fix.color);

      const vars = new Set(elements.map(colorVariableFor));
      const name = vars.size === 1 ? [...vars][0] : null;
      if (name && !varOverrides.has(name) && variableIsLocal(name, elements, f.fg, f.bg)) {
        varOverrides.set(name, to);
        fixes.push({ fg: f.fg, bg: f.bg, to, via: { kind: 'variable', name } });
      } else {
        for (const el of elements) inline.push([el, to]);
        const selector = suggestSelector(elements, f.bg);
        fixes.push({ fg: f.fg, bg: f.bg, to, via: { kind: 'inline', elements: elements.length, ...(selector ? { selector } : {}) } });
      }
    }
    return { fixes, inline };
  }

  /** The element is "in the same context" as the problematic ones: one of them, contains them, on the same background, or invisible. */
  function sameContext(m: Element, elements: Element[], bgKey: string): boolean {
    return (
      elements.some((el) => m === el || m.contains(el)) ||
      colorKey(view.getComputedStyle(m).backgroundColor) === bgKey ||
      !(m as HTMLElement).checkVisibility?.({ opacityProperty: true, visibilityProperty: true })
    );
  }

  /** A `tag.class.class` selector shared by the elements, if it matches nothing outside their context. */
  function suggestSelector(elements: Element[], bgKey: string): string | undefined {
    const esc = (s: string) => (view.CSS?.escape ? view.CSS.escape(s) : s.replace(/[^\w-]/g, (c) => `\\${c}`));
    const parts = new Set(
      elements.map((el) => {
        // Classes with `:`/`[`/`/` (Tailwind variants) are unstable for a selector — skipped.
        const classes = Array.from(el.classList).filter((c) => !/[:[\]/]/.test(c));
        return `${el.localName}${classes.map((c) => `.${esc(c)}`).join('')}`;
      }),
    );
    const selector = [...parts].join(', ');
    try {
      const matched = Array.from(doc.querySelectorAll(selector));
      return matched.length && matched.every((m) => sameContext(m, elements, bgKey)) ? selector : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * The variable may be changed only if it carries that color and every element using it
   * for text color is either one of the problematic ones, on the same background, or invisible.
   */
  function variableIsLocal(name: string, elements: Element[], fgKey: string, bgKey: string): boolean {
    if (!scan) return false;
    const value = colorKey(view.getComputedStyle(elements[0]!).getPropertyValue(name).trim());
    if (value !== fgKey) return false;
    for (const u of scan.usages) {
      if (u.source !== 'cssom' || u.property !== 'color' || !u.varRefs.includes(name) || u.nesting || u.scope) continue;
      let users: Element[];
      try {
        users = Array.from(doc.querySelectorAll(u.selector!));
      } catch {
        return false;
      }
      if (!users.every((m) => sameContext(m, elements, bgKey))) return false;
    }
    return true;
  }

  function startObserver() {
    if (opts.observe === false || observer) return;
    observer = new view.MutationObserver((records) => {
      if (!applied || !mapper) return;
      const added: Element[] = [];
      let sheetsChanged = false;
      for (const r of records) {
        const target = r.target as Element;
        if (r.type === 'attributes') {
          if (target.closest?.('[data-cc]')) continue;
          // The site changed the attribute itself: the new value is the new original, so remap it.
          patcher.forget(target, r.attributeName!);
          added.push(target);
        } else {
          for (const n of Array.from(r.addedNodes)) {
            if (n.nodeType !== 1) continue;
            const el = n as Element;
            if (el.closest('[data-cc]')) continue;
            if (el.localName === 'style' || (el.localName === 'link' && /stylesheet/i.test(el.getAttribute('rel') ?? ''))) {
              sheetsChanged = true;
              el.addEventListener('load', scheduleRescan, { once: true });
            } else {
              added.push(el);
            }
          }
        }
      }
      for (const el of added) patchInline(scanInline(el));
      observer?.takeRecords(); // don't reprocess our own changes
      if (sheetsChanged) scheduleRescan();
    });
    observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: OBSERVED_ATTRS });
  }

  /** New styles (CSS-in-JS, lazy CSS): re-read the rules, keep the same color map. */
  function scheduleRescan() {
    if (rescanTimer) clearTimeout(rescanTimer);
    rescanTimer = setTimeout(async () => {
      rescanTimer = null;
      if (!applied || !scan || !mapper) return;
      const usages: Usage[] = [];
      const roots: [string, Document | ShadowRoot][] = [['', doc], ...scan.scopes];
      for (const [prefix, root] of roots) {
        const css = await scanStylesheets(root, { ...opts, idPrefix: prefix });
        usages.push(...css.usages);
      }
      if (!applied) return;
      const inline = scan.usages.filter((u) => u.element);
      scan = { ...scan, usages: [...usages, ...inline] };
      cssByScope = buildOverrideCss(scan.usages, mapper, { varOverrides, isAlt });
      for (const [scope, css] of cssByScope) install(scope, css);
    }, 100);
  }

  function disableInternal() {
    observer?.disconnect();
    observer = null;
    if (rescanTimer) clearTimeout(rescanTimer);
    rescanTimer = null;
    uninstall();
    patcher.restore();
    applied = false;
  }

  const engine: ColorEngine = {
    get applied() {
      return applied;
    },
    get palette() {
      return palette;
    },
    get classification() {
      return classification;
    },

    async analyze() {
      if (applied) disableInternal(); // analysis must see the original colors
      scan = await scanDocument(doc, opts);
      classification = classify(scan, { ...opts, overrides });
      return { scan, classification };
    },

    setRoleOverride(key, role) {
      overrides[key] = role;
      if (scan) classification = classify(scan, { ...opts, overrides });
    },

    apply(next, applyOptions = {}) {
      if (!scan || !classification) throw new Error(coreText(opts.lang).analyzeFirst);
      if (applied) disableInternal();
      palette = next;

      const colorMap = applyOptions.colorMap ?? buildColorMap(classification, next, scan.pairs, opts);
      lastColorMap = colorMap;
      mapper = createColorMapper(colorMap.map);
      varOverrides = new Map();
      const local = planLocalContrast(colorMap);
      lastLocalFixes = local.fixes;

      cssByScope = buildOverrideCss(scan.usages, mapper, { varOverrides, isAlt });
      suppressTransitions();
      for (const [scope, css] of cssByScope) install(scope, css);
      patchInline(scan.usages.filter((u) => u.element));
      for (const [el, color] of local.inline) {
        if (el.namespaceURI === SVG_NS) patcher.setStyle(el as SVGElement, 'fill', color);
        else patcher.setStyle(el as HTMLElement, 'color', color);
      }
      const fallbackPatched = patchComputedFallback();
      applied = true;
      startObserver();

      const rules = [...cssByScope.values()].reduce((n, css) => n + (css.match(/\{\n {2}/g)?.length ?? 0), 0);
      return { colorMap, rules, patchedElements: patcher.size, localContrastFixes: local.fixes, fallbackPatched };
    },

    disable() {
      disableInternal();
    },

    toggle() {
      if (applied) {
        disableInternal();
        return false;
      }
      if (!palette) return false;
      engine.apply(palette, lastColorMap ? { colorMap: lastColorMap } : {});
      return true;
    },

    exportCss() {
      if (!scan || !classification || !palette) throw new Error(coreText(opts.lang).nothingToExport);
      const colorMap = lastColorMap ?? buildColorMap(classification, palette, scan.pairs, opts);
      const css = buildOverrideCss(scan.usages, createColorMapper(colorMap.map), { varOverrides, isAlt }).get('') ?? '';
      const localRules = lastLocalFixes
        .map((f) => (f.via.kind === 'inline' && f.via.selector ? `${f.via.selector} {\n  color: ${f.to};\n}` : ''))
        .filter(Boolean);
      const inline = scan.usages.filter((u) => u.element).length;
      const L = EXPORT_TEXT[opts.lang ?? 'sr'];
      const header = [
        `/* Website Color Changer — ${L.palette} ${palette.dominant} / ${palette.secondary} / ${palette.accent}`,
        `   ${L.after} */`,
        inline ? `/* ${L.inline(inline)} */` : '',
        ...lastLocalFixes
          .filter((f) => f.via.kind === 'inline' && !f.via.selector)
          .map((f) => `/* ${L.manual(f.fg, f.bg, f.to, (f.via as { elements: number }).elements)} */`),
      ]
        .filter(Boolean)
        .join('\n');
      const local = localRules.length ? `\n/* ${L.local} */\n${localRules.join('\n')}` : '';
      return `${header}\n${css}${local}\n`;
    },

    destroy() {
      disableInternal();
      scan = null;
      classification = null;
      lastColorMap = null;
      palette = null;
      mapper = null;
    },
  };
  return engine;
}
