import { collectDeclarations } from './cssom-scanner.js';
import { colorKeysIn, HTML_COLOR_ATTRS, SVG_COLOR_ATTRS } from './properties.js';
import type { Usage } from './types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Inline `style="…"` deklaracije, SVG prezentacioni atributi i zastareli HTML atributi boja. */
export function scanInline(root: Document | ShadowRoot | Element): Usage[] {
  const out: Usage[] = [];
  /** Za Element: i sam element, ne samo potomci. */
  const all = <T extends Element>(selector: string): T[] => {
    const list = Array.from(root.querySelectorAll<T>(selector));
    return root instanceof Element && root.matches(selector) ? [root as T, ...list] : list;
  };

  for (const el of all<HTMLElement | SVGElement>('[style]')) {
    if (el.closest('[data-cc]')) continue;
    collectDeclarations(el.style, undefined, { conditions: [], nesting: [], sheet: '' }, out, el);
  }

  const svgColorCache = new Map<Element, boolean>();
  const attrSelector = [...new Set([...SVG_COLOR_ATTRS, ...HTML_COLOR_ATTRS])].map((a) => `[${a}]`).join(',');
  for (const el of all(attrSelector)) {
    if (el.closest('[data-cc]')) continue;
    const isSvg = el.namespaceURI === SVG_NS;
    const attrs: readonly string[] = isSvg ? SVG_COLOR_ATTRS : HTML_COLOR_ATTRS;
    for (const attr of attrs) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const colors = colorKeysIn(value);
      if (!colors.length) continue;
      const usage: Usage = {
        source: isSvg ? 'svg-attr' : 'html-attr',
        property: attr,
        value,
        colors,
        varRefs: [],
        conditions: [],
        important: false,
        element: el,
      };
      if (isSvg && isMulticolorSvg(el, svgColorCache)) usage.multicolorSvg = true;
      out.push(usage);
    }
  }
  return out;
}

/** Da li `<svg>` kome element pripada ima ≥ 3 različite boje u fill/stroke atributima (logo, ilustracija). */
function isMulticolorSvg(el: Element, cache: Map<Element, boolean>): boolean {
  const svg = el.closest('svg');
  if (!svg) return false;
  let result = cache.get(svg);
  if (result === undefined) {
    const colors = new Set<string>();
    for (const node of [svg, ...Array.from(svg.querySelectorAll('[fill], [stroke], [stop-color]'))]) {
      for (const attr of ['fill', 'stroke', 'stop-color']) {
        const v = node.getAttribute(attr);
        if (v) for (const c of colorKeysIn(v)) colors.add(c);
      }
    }
    result = colors.size >= 3;
    cache.set(svg, result);
  }
  return result;
}
