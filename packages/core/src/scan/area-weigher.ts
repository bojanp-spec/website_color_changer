import { isLargeText } from '../color/contrast.js';
import { parseColor } from '../color/parse.js';
import { toHex } from '../color/serialize.js';
import { colorKeysIn } from './properties.js';
import type { ColorWeight, ContrastPair } from './types.js';

/** Elements we treat as interactive (accent color candidates). */
export const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input[type="submit"]',
  'input[type="button"]',
  'input[type="reset"]',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[class*="btn"]',
  '[class*="button"]',
  '[class*="cta"]',
].join(',');

const SVG_SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'text', 'tspan', 'use']);

/** Backgrounds below this alpha do not count as visible. */
const MIN_ALPHA = 0.05;

export interface WeighResult {
  weights: ColorWeight[];
  pairs: ContrastPair[];
  pairElements: Map<string, Element[]>;
  elements: number;
}

interface Solid {
  key: string;
  alpha: number;
}

/** Alpha from a canonical key (`#rrggbbaa` → aa/255; `#rrggbb` → 1). */
function keyAlpha(key: string): number {
  return key.length === 9 ? parseInt(key.slice(7), 16) / 255 : 1;
}

function solid(value: string): Solid | null {
  const p = parseColor(value);
  if (!p || p.rgba.a < MIN_ALPHA) return null;
  return { key: toHex(p.rgba), alpha: p.rgba.a };
}

function* walk(root: Document | ShadowRoot): Generator<Element> {
  const start = root instanceof Document ? root.documentElement : root;
  const walker = (root instanceof Document ? root : root.ownerDocument).createTreeWalker(start, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => ((n as Element).hasAttribute('data-cc') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = root instanceof Document ? walker.currentNode : walker.nextNode(); n; n = walker.nextNode()) {
    const el = n as Element;
    yield el;
    if (el.shadowRoot) yield* walk(el.shadowRoot);
  }
}

/** Parent in the "composed" tree (crosses the shadow root boundary). */
function composedParent(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.parentNode;
  return root instanceof ShadowRoot ? root.host : null;
}

/** The element's own text (excluding descendants' text), with collapsed whitespace. */
function ownText(el: Element): string {
  if (el instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(el.type)) return el.value.trim();
  let text = '';
  for (const n of Array.from(el.childNodes)) if (n.nodeType === Node.TEXT_NODE) text += n.textContent ?? '';
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Measures how much screen area each color takes (backgrounds, text, borders, SVG) across the whole
 * document — including below the fold. A descendant's background is subtracted from its ancestor's, so
 * only the truly visible part counts. Along the way it records text/background pairs for contrast checks.
 */
export function weighByArea(doc: Document): WeighResult {
  const view = doc.defaultView ?? window;
  const weights = new Map<string, ColorWeight>();
  const pairs = new Map<string, ContrastPair>();
  const pairElements = new Map<string, Element[]>();
  const bgOwner = new Map<Element, string>();
  let elements = 0;

  const w = (key: string): ColorWeight => {
    let entry = weights.get(key);
    if (!entry) {
      entry = { key, bgArea: 0, textArea: 0, borderArea: 0, svgArea: 0, interactiveArea: 0, elementCount: 0 };
      weights.set(key, entry);
    }
    return entry;
  };

  // --- Canvas: the <html> background, or the propagated <body> one, or default white.
  const html = doc.documentElement;
  const body = doc.body;
  const htmlBg = solid(view.getComputedStyle(html).backgroundColor);
  const bodyBg = body ? solid(view.getComputedStyle(body).backgroundColor) : null;
  const canvas = htmlBg ?? bodyBg;
  const canvasKey = canvas?.key ?? '#ffffff';
  const canvasArea = Math.max(html.scrollWidth, view.innerWidth) * Math.max(html.scrollHeight, view.innerHeight);
  const canvasWeight = w(canvasKey);
  canvasWeight.bgArea += canvasArea;
  if (!canvas) canvasWeight.implicit = true;
  bgOwner.set(html, canvasKey);
  const bodyIsCanvas = !htmlBg && !!bodyBg;

  for (const el of walk(doc)) {
    elements++;
    if (el === html) continue;
    const parent = composedParent(el);
    const parentOwner = (parent && bgOwner.get(parent)) ?? canvasKey;
    bgOwner.set(el, parentOwner);

    const cs = view.getComputedStyle(el);
    if (cs.display === 'none') continue;
    const visible =
      typeof el.checkVisibility === 'function'
        ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
        : cs.visibility !== 'hidden' && cs.opacity !== '0';
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    const interactive = el.closest(INTERACTIVE_SELECTOR) !== null;
    const touched = new Set<string>();
    const add = (key: string, field: 'bgArea' | 'textArea' | 'borderArea' | 'svgArea', amount: number) => {
      if (amount <= 0) return;
      const entry = w(key);
      entry[field] += amount;
      if (interactive) entry.interactiveArea += amount;
      touched.add(key);
    };

    // --- Background (color and gradients)
    if (!(el === body && bodyIsCanvas)) {
      const bg = solid(cs.backgroundColor);
      // Transparent stops (Tailwind `from-transparent` → rgba(0,0,0,0)) are invisible — not counted.
      const gradientKeys = /gradient\(/.test(cs.backgroundImage)
        ? colorKeysIn(cs.backgroundImage).filter((k) => keyAlpha(k) >= MIN_ALPHA)
        : [];
      if (visible && area > 0 && (bg || gradientKeys.length)) {
        const covered = Math.max(bg?.alpha ?? 0, gradientKeys.length ? 1 : 0);
        if (bg) add(bg.key, 'bgArea', area * (gradientKeys.length ? 0 : 1));
        for (const k of gradientKeys) add(k, 'bgArea', area / gradientKeys.length);
        // This part of the ancestor's background is not visible.
        w(parentOwner).bgArea -= area * covered;
        bgOwner.set(el, bg?.key ?? gradientKeys[0] ?? parentOwner);
      }
    }
    if (!visible || area === 0) {
      if (touched.size) elementCountBump(touched);
      continue;
    }

    // --- SVG shapes
    if (el.namespaceURI === 'http://www.w3.org/2000/svg' && SVG_SHAPES.has(el.localName)) {
      const fill = solid(cs.fill);
      if (fill) add(fill.key, 'svgArea', area * 0.5);
      const stroke = cs.stroke !== 'none' ? solid(cs.stroke) : null;
      const sw = parseFloat(cs.strokeWidth) || 0;
      if (stroke && sw > 0) add(stroke.key, 'svgArea', 2 * (rect.width + rect.height) * sw);
    }

    // --- Text
    const text = ownText(el);
    if (text) {
      const fg = solid(cs.color);
      const fontSize = parseFloat(cs.fontSize) || 16;
      const fontWeight = parseInt(cs.fontWeight, 10) || 400;
      if (fg) {
        const ink = text.length * fontSize * fontSize * 0.5;
        add(fg.key, 'textArea', ink);
        const bgKey = bgOwner.get(el) ?? canvasKey;
        const pairKey = `${fg.key}|${bgKey}`;
        const small = !isLargeText(fontSize, fontWeight);
        const els = pairElements.get(pairKey) ?? [];
        if (els.length < 200) els.push(el);
        pairElements.set(pairKey, els);
        const pair = pairs.get(pairKey);
        if (pair) {
          pair.weight += ink;
          pair.minFontSize = Math.min(pair.minFontSize, fontSize);
          pair.hasSmallText ||= small;
        } else {
          pairs.set(pairKey, { fg: fg.key, bg: bgKey, weight: ink, minFontSize: fontSize, hasSmallText: small });
        }
      }
    }

    // --- Borders
    const sides = [
      ['Top', rect.width],
      ['Right', rect.height],
      ['Bottom', rect.width],
      ['Left', rect.height],
    ] as const;
    for (const [side, length] of sides) {
      const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`);
      const width = parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`)) || 0;
      if (width <= 0 || style === 'none' || style === 'hidden') continue;
      const color = solid(cs.getPropertyValue(`border-${side.toLowerCase()}-color`));
      if (color) add(color.key, 'borderArea', length * width);
    }

    elementCountBump(touched);
  }

  function elementCountBump(keys: Set<string>) {
    for (const k of keys) w(k).elementCount++;
  }

  for (const entry of weights.values()) entry.bgArea = Math.max(0, entry.bgArea);
  return { weights: [...weights.values()], pairs: [...pairs.values()], pairElements, elements };
}
