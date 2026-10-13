import type { Usage } from '../scan/types.js';
import type { ColorMapper } from './mapper.js';

export interface OverrideOptions {
  /**
   * Lokalne korekcije varijabli (npr. `--accent-contrast` → `#ffffff` za tekst na CTA dugmetu).
   * Primenjuju se na definicije varijable koje nisu u alternativnoj šemi.
   */
  varOverrides?: ReadonlyMap<string, string>;
  /** Da li je deklaracija u alternativnoj šemi (dark mode) — tamo se `varOverrides` ne primenjuje. */
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
 * Faza 4: pravi CSS sloj koji preslikava SAMO boje. Za svaku originalnu deklaraciju boje
 * nastaje deklaracija sa istim selektorom, istim omotačima (`@layer`, `@media`, `@supports`,
 * nesting) i istom važnošću (`!important` samo ako ga ima i original). Pošto se sloj dodaje
 * posle svih stilova sajta (adoptedStyleSheets), pobeđuje original pri istoj specifičnosti,
 * a međusobni odnos pravila (hover, media, slojevi) ostaje isti kao na sajtu.
 *
 * Vraća CSS po scope-u (`''` = dokument, inače prefiks shadow root-a).
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
