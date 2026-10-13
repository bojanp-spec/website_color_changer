import { hasColor } from '../color/tokenize.js';
import { colorKeysIn, isColorProperty, varRefsIn } from './properties.js';
import type { SheetReport, Usage } from './types.js';

/** Returns the CSS file text, or `null` if unavailable. */
export type CssFetcher = (href: string) => Promise<string | null>;

export interface CssomScanOptions {
  /**
   * How to get cross-origin stylesheets whose rules the browser hides (SecurityError).
   * Default: `fetch` with CORS. `false` disables re-fetching.
   */
  fetchCss?: CssFetcher | false;
  /** Prefix for stylesheet ids (used for shadow roots). */
  idPrefix?: string;
}

export const defaultFetchCss: CssFetcher = async (href) => {
  try {
    const res = await fetch(href, { mode: 'cors', credentials: 'omit' });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
};

export interface WalkContext {
  conditions: string[];
  nesting: string[];
  sheet: string;
  scope?: string;
}

/** Scans all stylesheets of a document or shadow root (including `@import` and adoptedStyleSheets). */
export async function scanStylesheets(
  root: Document | ShadowRoot,
  opts: CssomScanOptions = {},
): Promise<{ usages: Usage[]; sheets: SheetReport[] }> {
  const fetchCss = opts.fetchCss === undefined ? defaultFetchCss : opts.fetchCss;
  const prefix = opts.idPrefix ?? '';
  const usages: Usage[] = [];
  const sheets: SheetReport[] = [];
  let styleIdx = 0;

  const visit = async (sheet: CSSStyleSheet, owner: SheetReport['owner'], fallbackId: string) => {
    const ownerNode = sheet.ownerNode as Element | null;
    if (ownerNode?.closest?.('[data-cc]')) return; // our own layer
    const href = sheet.href;
    const id = href ?? `${prefix}${fallbackId}`;
    const report: SheetReport = { id, href, owner, status: 'ok', ruleCount: 0 };
    sheets.push(report);

    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      rules = null;
    }
    if (!rules && href && fetchCss) {
      const text = await fetchCss(href);
      if (text !== null) {
        const copy = new CSSStyleSheet();
        copy.replaceSync(text); // @import is ignored here — acceptable for a fallback
        rules = copy.cssRules;
        report.status = 'refetched';
      }
    }
    if (!rules) {
      report.status = 'blocked';
      return;
    }

    const imports: CSSImportRule[] = [];
    report.ruleCount = walkRules(rules, { conditions: [], nesting: [], sheet: id, scope: prefix }, usages, imports);
    for (const imp of imports) {
      if (imp.styleSheet) await visit(imp.styleSheet, 'import', `${id}@import`);
    }
  };

  for (const sheet of Array.from(root.styleSheets)) {
    const isLink = sheet.ownerNode instanceof Element && sheet.ownerNode.localName === 'link';
    await visit(sheet, isLink ? 'link' : 'style', `style#${styleIdx++}`);
  }
  const adopted = root.adoptedStyleSheets ?? [];
  for (let i = 0; i < adopted.length; i++) {
    const sheet = adopted[i];
    if (sheet && !(sheet as CSSStyleSheet & { __cc?: boolean }).__cc) await visit(sheet, 'adopted', `adopted#${i}`);
  }
  return { usages, sheets };
}

/** Walks rules recursively; returns the number of rules visited. */
function walkRules(rules: CSSRuleList, ctx: WalkContext, out: Usage[], imports: CSSImportRule[]): number {
  let count = 0;
  for (const rule of Array.from(rules)) {
    count++;
    if (rule instanceof CSSImportRule) {
      imports.push(rule);
    } else if (rule instanceof CSSStyleRule) {
      collectDeclarations(rule.style, rule.selectorText, ctx, out);
      if (rule.cssRules?.length) {
        count += walkRules(rule.cssRules, { ...ctx, nesting: [...ctx.nesting, rule.selectorText] }, out, imports);
      }
    } else if (rule instanceof CSSKeyframesRule) {
      const first = out.length;
      for (const kf of Array.from(rule.cssRules) as CSSKeyframeRule[]) {
        count++;
        collectDeclarations(kf.style, `@keyframes ${rule.name} ${kf.keyText}`, ctx, out);
      }
      for (let i = first; i < out.length; i++) out[i]!.ruleText = rule.cssText;
    } else if (rule instanceof CSSGroupingRule) {
      // @media, @supports, @layer, @container, @scope, @starting-style ...
      count += walkRules(rule.cssRules, { ...ctx, conditions: [...ctx.conditions, conditionOf(rule)] }, out, imports);
    } else if ('style' in rule && (rule as CSSRule & { style: CSSStyleDeclaration }).style) {
      // CSSNestedDeclarations (declarations after nested rules) and the like
      const parentSelector = ctx.nesting[ctx.nesting.length - 1] ?? ':root';
      collectDeclarations((rule as CSSRule & { style: CSSStyleDeclaration }).style, parentSelector, { ...ctx, nesting: ctx.nesting.slice(0, -1) }, out);
    }
  }
  return count;
}

/** Header of a grouping rule: `@media (max-width: 600px)`. */
function conditionOf(rule: CSSGroupingRule): string {
  const text = rule.cssText;
  const brace = text.indexOf('{');
  return (brace === -1 ? text : text.slice(0, brace)).trim().replace(/\s+/g, ' ');
}

export function collectDeclarations(
  style: CSSStyleDeclaration,
  selector: string | undefined,
  ctx: WalkContext,
  out: Usage[],
  element?: Element,
) {
  const pending = new Set<string>();
  const push = (property: string, value: string) => {
    const isVar = property.startsWith('--');
    const colors = colorKeysIn(value);
    const varRefs = varRefsIn(value);
    if (!colors.length && !varRefs.length) return;
    const usage: Usage = {
      source: isVar ? 'variable' : element ? 'inline' : 'cssom',
      property,
      value,
      colors,
      varRefs,
      conditions: ctx.conditions,
      important: style.getPropertyPriority(property) === 'important',
    };
    if (selector !== undefined) usage.selector = selector;
    if (ctx.sheet) usage.sheet = ctx.sheet;
    if (ctx.scope !== undefined) usage.scope = ctx.scope;
    if (ctx.nesting.length) usage.nesting = ctx.nesting;
    if (element) usage.element = element;
    out.push(usage);
  };

  for (let i = 0; i < style.length; i++) {
    const property = style.item(i);
    const value = style.getPropertyValue(property).trim();
    if (!value) {
      // A shorthand with var() (e.g. `background: var(--bg)`) leaves the longhands empty
      // ("pending substitution") — the value is only available via the shorthand.
      if (isColorProperty(property)) pending.add(property);
      continue;
    }
    const isVar = property.startsWith('--');
    if (isVar ? !hasColor(value) : !isColorProperty(property)) continue;
    push(property, value);
  }

  if (!pending.size) return;
  for (const [shorthand, longhands] of SHORTHANDS) {
    if (!longhands.some((l) => pending.has(l))) continue;
    const value = style.getPropertyValue(shorthand).trim();
    if (!value) continue;
    push(shorthand, value);
    for (const l of longhands) pending.delete(l);
  }
}

const SIDES = ['top', 'right', 'bottom', 'left'];

/** Shorthands that can carry a color, from broadest to narrowest, with the color longhands they cover. */
const SHORTHANDS: [string, string[]][] = [
  ['background', ['background-color', 'background-image']],
  ['border', SIDES.map((s) => `border-${s}-color`)],
  ['border-color', SIDES.map((s) => `border-${s}-color`)],
  ...SIDES.map((s): [string, string[]] => [`border-${s}`, [`border-${s}-color`]]),
  ['border-block', ['border-block-start-color', 'border-block-end-color']],
  ['border-inline', ['border-inline-start-color', 'border-inline-end-color']],
  ['border-block-start', ['border-block-start-color']],
  ['border-block-end', ['border-block-end-color']],
  ['border-inline-start', ['border-inline-start-color']],
  ['border-inline-end', ['border-inline-end-color']],
  ['border-image', ['border-image-source']],
  ['outline', ['outline-color']],
  ['text-decoration', ['text-decoration-color']],
  ['text-emphasis', ['text-emphasis-color']],
  ['column-rule', ['column-rule-color']],
  ['list-style', ['list-style-image']],
  ['mask', ['mask-image']],
];
