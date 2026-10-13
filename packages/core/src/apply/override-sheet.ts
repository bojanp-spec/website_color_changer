import type { Usage } from '../scan/types.js';
import type { ColorMapper } from './mapper.js';

export interface OverrideOptions {
  /**
   * Local variable overrides (e.g. `--accent-contrast` → `#ffffff` for text on a CTA button).
   * Applied to variable definitions that are not in the alternate scheme.
   */
  varOverrides?: ReadonlyMap<string, string>;
  /** Whether the declaration is in the alternate scheme (dark mode) — `varOverrides` is not applied there. */
  isAlt?: (u: Usage) => boolean;
}

interface Group {
  scope: string;
  conditions: string[];
  nesting: string[];
  selector: string;
  decls: string[];
}

const sameContext = (g: Group, u: Usage, scope: string) =>
  g.scope === scope &&
  g.selector === u.selector &&
  g.conditions.join('\n') === u.conditions.join('\n') &&
  g.nesting.join('\n') === (u.nesting ?? []).join('\n');

const wrap = (inner: string, headers: string[]) => headers.reduceRight((acc, h) => `${h} {\n${acc}\n}`, inner);

/**
 * Phase 4: builds a CSS layer that remaps ONLY colors. Every original color declaration
 * yields a declaration with the same selector, the same wrappers (`@layer`, `@media`, `@supports`,
 * nesting) and the same importance (`!important` only if the original has it). Since the layer is
 * added after all site styles (adoptedStyleSheets), it beats the original at equal specificity,
 * while the relationships between rules (hover, media, layers) stay the same as on the site.
 *
 * Returns CSS per scope (`''` = document, otherwise a shadow root prefix).
 */
export function buildOverrideCss(usages: readonly Usage[], mapper: ColorMapper, opts: OverrideOptions = {}): Map<string, string> {
  const groups: Group[] = [];
  const keyframes = new Map<string, { scope: string; conditions: string[]; text: string }>();

  for (const u of usages) {
    if ((u.source !== 'cssom' && u.source !== 'variable') || u.selector === undefined) continue;
    const scope = u.scope ?? '';

    if (u.ruleText) {
      const id = `${scope}\n${u.conditions.join('\n')}\n${u.ruleText}`;
      if (!keyframes.has(id)) {
        const text = mapper.mapValue(u.ruleText);
        if (text !== u.ruleText) keyframes.set(id, { scope, conditions: u.conditions, text });
      }
      continue;
    }

    const forced = u.source === 'variable' && !opts.isAlt?.(u) ? opts.varOverrides?.get(u.property) : undefined;
    const value = forced ?? mapper.mapValue(u.value);
    if (value === u.value) continue;

    const decl = `${u.property}: ${value}${u.important ? ' !important' : ''};`;
    const last = groups[groups.length - 1];
    if (last && sameContext(last, u, scope)) {
      last.decls.push(decl);
    } else {
      groups.push({ scope, conditions: u.conditions, nesting: u.nesting ?? [], selector: u.selector, decls: [decl] });
    }
  }

  const out = new Map<string, string[]>();
  const push = (scope: string, css: string) => out.set(scope, [...(out.get(scope) ?? []), css]);
  for (const g of groups) {
    const rule = `${g.selector} {\n  ${g.decls.join('\n  ')}\n}`;
    push(g.scope, wrap(wrap(rule, g.nesting), g.conditions));
  }
  for (const k of keyframes.values()) push(k.scope, wrap(k.text, k.conditions));
  return new Map([...out].map(([scope, rules]) => [scope, rules.join('\n')]));
}
