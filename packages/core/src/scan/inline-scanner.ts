import { collectDeclarations } from './cssom-scanner.js';
import { colorKeysIn, HTML_COLOR_ATTRS, SVG_COLOR_ATTRS } from './properties.js';
import type { Usage } from './types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Inline `style="…"` deklaracije, SVG prezentacioni atributi i zastareli HTML atributi boja. */
export function scanInline(root: Document | ShadowRoot): Usage[] {
  const out: Usage[] = [];

  for (const el of Array.from(root.querySelectorAll<HTMLElement | SVGElement>('[style]'))) {
    if (el.closest('[data-cc]')) continue;
    collectDeclarations(el.style, undefined, { conditions: [], nesting: [], sheet: '' }, out, el);
  }

  const attrSelector = [...new Set([...SVG_COLOR_ATTRS, ...HTML_COLOR_ATTRS])].map((a) => `[${a}]`).join(',');
  for (const el of Array.from(root.querySelectorAll(attrSelector))) {
    if (el.closest('[data-cc]')) continue;
    const isSvg = el.namespaceURI === SVG_NS;
    const attrs: readonly string[] = isSvg ? SVG_COLOR_ATTRS : HTML_COLOR_ATTRS;
    for (const attr of attrs) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const colors = colorKeysIn(value);
      if (!colors.length) continue;
      out.push({
        source: isSvg ? 'svg-attr' : 'html-attr',
        property: attr,
        value,
        colors,
        varRefs: [],
        conditions: [],
        important: false,
        element: el,
      });
    }
  }
  return out;
}
