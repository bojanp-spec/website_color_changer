import { isLargeText } from '../color/contrast.js';
import { parseColor } from '../color/parse.js';
import { toHex } from '../color/serialize.js';
import { colorKeysIn } from './properties.js';
import type { ColorWeight, ContrastPair } from './types.js';

/** Elementi koje tretiramo kao interaktivne (kandidati za akcentnu boju). */
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

/** Ispod ove alfe pozadina se ne računa kao vidljiva. */
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

/** Alfa iz kanonskog ključa (`#rrggbbaa` → aa/255; `#rrggbb` → 1). */
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

/** Roditelj u „composed" stablu (prelazi granicu shadow root-a). */
function composedParent(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.parentNode;
  return root instanceof ShadowRoot ? root.host : null;
}

/** Direktni tekst elementa (bez teksta potomaka), sa skupljenim razmacima. */
function ownText(el: Element): string {
  if (el instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(el.type)) return el.value.trim();
  let text = '';
  for (const n of Array.from(el.childNodes)) if (n.nodeType === Node.TEXT_NODE) text += n.textContent ?? '';
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Meri koliku površinu ekrana zauzima svaka boja (pozadine, tekst, ivice, SVG) na celom
 * dokumentu — i ispod pregiba. Pozadina potomka se oduzima od pozadine pretka, pa se
 * računa samo zaista vidljiv deo. Usput beleži parove tekst/pozadina za proveru kontrasta.
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

  // --- Platno (canvas): pozadina <html>, ili <body> koja se propagira, ili podrazumevana bela.
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

    // --- Pozadina (boja i gradijenti)
    if (!(el === body && bodyIsCanvas)) {
      const bg = solid(cs.backgroundColor);
      // Providne stanice (Tailwind `from-transparent` → rgba(0,0,0,0)) se ne vide — ne računaju se.
      const gradientKeys = /gradient\(/.test(cs.backgroundImage)
        ? colorKeysIn(cs.backgroundImage).filter((k) => keyAlpha(k) >= MIN_ALPHA)
        : [];
      if (visible && area > 0 && (bg || gradientKeys.length)) {
        const covered = Math.max(bg?.alpha ?? 0, gradientKeys.length ? 1 : 0);
        if (bg) add(bg.key, 'bgArea', area * (gradientKeys.length ? 0 : 1));
        for (const k of gradientKeys) add(k, 'bgArea', area / gradientKeys.length);
        // Ovaj deo pretkove pozadine se ne vidi.
        w(parentOwner).bgArea -= area * covered;
        bgOwner.set(el, bg?.key ?? gradientKeys[0] ?? parentOwner);
      }
    }
    if (!visible || area === 0) {
      if (touched.size) elementCountBump(touched);
      continue;
    }

    // --- SVG oblici
    if (el.namespaceURI === 'http://www.w3.org/2000/svg' && SVG_SHAPES.has(el.localName)) {
      const fill = solid(cs.fill);
      if (fill) add(fill.key, 'svgArea', area * 0.5);
      const stroke = cs.stroke !== 'none' ? solid(cs.stroke) : null;
      const sw = parseFloat(cs.strokeWidth) || 0;
      if (stroke && sw > 0) add(stroke.key, 'svgArea', 2 * (rect.width + rect.height) * sw);
    }

    // --- Tekst
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

    // --- Ivice
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
