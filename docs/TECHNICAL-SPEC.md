# Website Color Changer — technical specification

🇷🇸 *Srpska verzija: [UPUTSTVO-ZA-KODIRANJE.md](UPUTSTVO-ZA-KODIRANJE.md)*

> Technical specification and implementation plan for a tool that changes the color palette of an **existing website** without changing its structure, HTML, JS logic or functionality — following the **60-30-10** rule.
>
> This document was written before the implementation. Where the code ended up differing, see [Implementation notes](#14-implementation-notes) at the end.

---

## 1. Goal and constraints

### What the tool does
1. Loads on any existing website (without changing its code).
2. **Detects the existing palette** (e.g. blue-gray shades).
3. **Classifies the colors into three roles** following the 60-30-10 rule:
   | Role | Share | Typically on the site |
   |---|---|---|
   | **Dominant (60%)** | backgrounds | `body`, sections, header/footer backgrounds |
   | **Secondary (30%)** | structure | text, cards, borders, navigation, icons |
   | **Accent (10%)** | conversion | CTA buttons, links, badges, focus states |
4. The user picks **three new colors** (or a ready-made preset: “red/gray”, “yellow/green”...).
5. The tool **maps every old shade to a new one**, keeping the lightness relationships (hover darker, disabled lighter, etc.).
6. It is applied **as a layer on top of the site** — turning the layer off makes the site identical to the original.

### Hard rules (non-negotiable)
- ❌ The DOM structure, classes, IDs and attributes are not changed (except our single `<style>` tag and our UI in a Shadow DOM).
- ❌ Existing JS, event handlers, layout, typography, spacing and sizes are not changed.
- ❌ Images (`<img>`, `background-image: url()`), video and canvas are not touched — only CSS colors (optionally SVG, see §7).
- ✅ **Only color values** in CSS properties are changed.
- ✅ Fully reversible: `disable()` restores the site to its original state without a reload.

---

## 2. Architecture

One core with no environment dependencies + thin delivery “adapters”.

```
website_color_changer/
├── packages/
│   ├── core/                  # pure logic, no DOM UI
│   │   ├── src/
│   │   │   ├── color/
│   │   │   │   ├── parse.ts         # string → RGBA (hex, rgb, hsl, oklch, named, color-mix)
│   │   │   │   ├── convert.ts       # RGB ↔ OKLCH (and back), gamut mapping
│   │   │   │   ├── contrast.ts      # WCAG 2.x contrast + APCA (optional)
│   │   │   │   └── serialize.ts     # RGBA → CSS string
│   │   │   ├── scan/
│   │   │   │   ├── cssom-scanner.ts     # reads stylesheet rules
│   │   │   │   ├── computed-scanner.ts  # fallback: getComputedStyle per element
│   │   │   │   ├── variables-scanner.ts # CSS custom properties (--primary...)
│   │   │   │   └── area-weigher.ts      # how many pixels each color covers
│   │   │   ├── analyze/
│   │   │   │   ├── cluster.ts       # grouping similar shades
│   │   │   │   └── classify.ts      # assigning the 60/30/10 roles
│   │   │   ├── map/
│   │   │   │   └── remap.ts         # old color → new color (keeps relationships)
│   │   │   ├── apply/
│   │   │   │   ├── override-sheet.ts    # generates and injects the <style>
│   │   │   │   ├── inline-patcher.ts    # elements with inline style="color:..."
│   │   │   │   └── observer.ts          # MutationObserver for dynamic content
│   │   │   ├── engine.ts            # public API (see §3)
│   │   │   └── types.ts
│   │   └── test/
│   ├── ui/                    # floating panel (Shadow DOM, isolated from the site)
│   ├── bookmarklet/           # build → javascript:... link
│   ├── extension/             # Chrome/Firefox MV3 extension
│   └── cli/                   # Playwright + PostCSS: exporting permanent CSS
├── fixtures/                  # test sites (blue-gray, with variables, without variables, Tailwind, Bootstrap)
└── docs/
```

**Stack:** TypeScript, Vite (library mode, IIFE build for the bookmarklet/inject), Vitest (unit), Playwright (e2e + visual regression). For color conversions: [`culori`](https://culorijs.org/) (small, tree-shakeable) — or our own OKLCH implementation (~150 lines) if we want zero dependencies.

### Delivery methods (same core)
| Adapter | When | Note |
|---|---|---|
| **Bookmarklet** | quick testing on any site | limited by some sites' CSP |
| **Browser extension** | the main testing tool | bypasses CSP and CORS for stylesheets |
| **`<script>` snippet** | dev/staging environment of your own site | `?cc=1` in the URL turns it on |
| **CLI (export)** | once a variant is chosen → permanent `theme-override.css` | goes to production as one extra CSS file |

---

## 3. Core public API

```ts
// packages/core/src/types.ts
export type Role = 'dominant' | 'secondary' | 'accent' | 'neutral-text';

export interface Palette {
  dominant: string;   // e.g. '#FFFFFF' or '#121212' (dark)
  secondary: string;  // e.g. '#4A4A4A'
  accent: string;     // e.g. '#E53935'
}

export interface ColorToken {
  original: string;          // the exact string from the CSS
  oklch: { l: number; c: number; h: number; a: number };
  role: Role;
  area: number;              // weight: area in pixels (backgrounds) or number of glyphs (text)
  usages: Usage[];           // where it appears
}

export interface Usage {
  source: 'cssom' | 'inline' | 'variable' | 'computed' | 'svg-attr';
  selector?: string;         // for cssom
  property: string;          // 'background-color', 'border-top-color', '--brand', ...
  media?: string;            // @media condition if any
  element?: WeakRef<Element>;// for inline/computed
}

export interface Analysis {
  tokens: ColorToken[];
  detected: Palette;         // what the tool thinks the current 60/30/10 palette is
}

export interface EngineOptions {
  preserveNeutrals?: boolean;   // default true: don't color white/black/grays (only a slight tint, see §6)
  neutralTint?: number;         // 0..1, how much neutrals take the hue of the new secondary (default 0.0)
  enforceContrast?: 'AA' | 'AAA' | false; // default 'AA'
  includeSvg?: boolean;         // default true
  observeMutations?: boolean;   // default true
}

export interface ColorEngine {
  analyze(): Promise<Analysis>;
  setRoleOverride(original: string, role: Role): void; // manual classification fix
  apply(palette: Palette): void;
  disable(): void;               // restores the original (removes the layer)
  toggle(): void;                // A/B comparison
  exportCss(): string;           // permanent override CSS
  destroy(): void;
}

export function createEngine(doc: Document, opts?: EngineOptions): ColorEngine;
```

---

## 4. Phase 1 — Scanning colors

### 4.1 Why CSSOM, and not just `getComputedStyle`
`getComputedStyle` only sees **the current state** — it doesn't see `:hover`, `:focus`, `:active`, `:disabled`, `@media (prefers-color-scheme)`, mobile breakpoints, or elements that aren't on the page yet (modals, dropdowns). That is why the **primary source is the CSSOM** (rules from the stylesheets), and the computed style is the fallback and the source of the “weight” (area).

### 4.2 Properties that carry color
```ts
// packages/core/src/scan/properties.ts
export const COLOR_PROPS = [
  'color', 'background-color', 'background', 'background-image', // gradients!
  'border-color', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color', 'border',
  'outline-color', 'outline', 'text-decoration-color', 'text-emphasis-color',
  'column-rule-color', 'caret-color', 'accent-color',
  'box-shadow', 'text-shadow',
  'fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color',
  'scrollbar-color', '-webkit-text-fill-color', '-webkit-tap-highlight-color',
] as const;
```
Shorthands (`background`, `border`, `box-shadow`, gradients) contain colors **inside** a longer string → use a tokenizer that extracts only the colors and puts them back in **the same place** (the rest of the string — `url()`, positions, widths — stays untouched).

```ts
// packages/core/src/color/parse.ts
const COLOR_RE =
  /#(?:[0-9a-f]{3,4}){1,2}\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|\b(?:transparent|currentcolor|[a-z]+)\b/gi;

/** Replace every color in the value by calling fn; the rest of the string stays byte-identical. */
export function replaceColors(value: string, fn: (c: string) => string): string {
  return value.replace(COLOR_RE, (m) => {
    if (/^(transparent|currentcolor|inherit|initial|unset)$/i.test(m)) return m;
    if (/^[a-z]+$/i.test(m) && !NAMED_COLORS.has(m.toLowerCase())) return m; // 'solid', 'none'...
    if (/url\(/i.test(m)) return m;
    return fn(m);
  });
}
```
> ⚠️ Don't replace anything inside `url(...)` — first extract the `url()` segments, then tokenize the rest.

### 4.3 CSSOM scanner
```ts
// packages/core/src/scan/cssom-scanner.ts
export async function scanStylesheets(doc: Document): Promise<Usage[]> {
  const out: Usage[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;               // throws SecurityError for cross-origin CSS
    } catch {
      rules = await refetchSheet(sheet);    // see 4.4
      if (!rules) continue;
    }
    walkRules(rules, out, /*media*/ undefined);
  }
  // Shadow DOM web components: adoptedStyleSheets + <style> inside the shadowRoot
  for (const host of findShadowHosts(doc)) { /* the same, per shadowRoot */ }
  return out;
}

function walkRules(rules: CSSRuleList, out: Usage[], media?: string) {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      for (const prop of Array.from(rule.style)) {
        const val = rule.style.getPropertyValue(prop);
        if (prop.startsWith('--') ? looksLikeColor(val) : isColorProp(prop) && hasColor(val)) {
          out.push({ source: prop.startsWith('--') ? 'variable' : 'cssom',
                     selector: rule.selectorText, property: prop, media });
        }
      }
      if ((rule as any).cssRules?.length) walkRules((rule as any).cssRules, out, media); // CSS nesting
    } else if (rule instanceof CSSMediaRule) {
      walkRules(rule.cssRules, out, rule.conditionText);
    } else if (rule instanceof CSSSupportsRule || rule instanceof CSSLayerBlockRule || rule instanceof CSSContainerRule) {
      walkRules((rule as CSSGroupingRule).cssRules, out, media);
    }
    // @keyframes: CSSKeyframesRule → animated colors are mapped too
  }
}
```

### 4.4 Cross-origin stylesheets (CDN, Google Fonts, Bootstrap from a CDN)
- **Extension:** `fetch(sheet.href)` from the background service worker (it has host permissions) → parse the text into `new CSSStyleSheet()` via `replaceSync()` → read the rules.
- **Bookmarklet/snippet:** try `fetch(href, {mode:'cors'})`; if that fails, switch to the **computed fallback** only for the elements affected by that file.

### 4.5 Inline styles and SVG attributes
```ts
doc.querySelectorAll<HTMLElement>('[style]')         // style="background:#1e3a8a"
doc.querySelectorAll('[fill],[stroke],[stop-color]') // <path fill="#1e3a8a">
doc.querySelectorAll('[bgcolor],[color]')            // legacy <td bgcolor>, <font color>
```

### 4.6 Area weighting (key to 60-30-10)
The number of occurrences in the CSS **does not tell** which color is dominant. We need to measure how much of the screen it covers:

```ts
// packages/core/src/scan/area-weigher.ts
export function weighByArea(doc: Document): Map<string, { bgArea: number; textArea: number; borderArea: number }> {
  const acc = new Map();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  for (let el = walker.currentNode as Element; el; el = walker.nextNode() as Element) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;

    // background: subtract the area of children with their own opaque background (visible area)
    const bg = cs.backgroundColor;
    if (alpha(bg) > 0.05) add(acc, norm(bg), 'bgArea', visibleArea(el, area));

    // text: number of characters × font-size² (approximate “ink”)
    const text = ownText(el);
    if (text) add(acc, norm(cs.color), 'textArea', text.length * parseFloat(cs.fontSize) ** 2 * 0.5);

    // borders: perimeter × width
    // ...
  }
  return acc;
}
```
> Scan the whole document (not just the viewport) — `getBoundingClientRect` also works for elements below the fold. For very large pages (>5000 elements) sample, or work in `requestIdleCallback` chunks.

---

## 5. Phase 2 — Analysis and classification (60-30-10)

### 5.1 Work in the OKLCH space
OKLCH is perceptually uniform: `L` = lightness (0–1), `C` = chroma (saturation), `H` = hue (0–360°). This lets “blue 500” become “red 500” with **the same visual weight** — something HSL doesn't guarantee (yellow and blue with the same HSL L look completely different in lightness).

### 5.2 Clustering
1. Normalize all colors to OKLCH; ignore alpha for clustering (but remember it).
2. **Neutrals:** `C < 0.03` → a separate group (whites, grays, blacks). Blue-grays (`C` 0.01–0.05, `H` ≈ 250°) are “tinted neutrals” — remember that they have a tint, because it changes too.
3. **Chromatic colors:** group by hue `H` (±20° window), then within a group by `L`. A simple approach: k-means with ΔE_OK < 0.04 as the merge threshold.
4. Each cluster gets a **base color** = the color with the largest weight in the cluster.

### 5.3 Assigning roles (heuristic)
```ts
// packages/core/src/analyze/classify.ts
export function classify(clusters: Cluster[], usage: UsageStats): Palette & { roles: Map<Cluster, Role> } {
  // DOMINANT: the cluster with the largest bgArea (almost always neutral: white/light gray or dark)
  const dominant = maxBy(clusters, c => c.bgArea);

  // ACCENT: a chromatic cluster (C > 0.08) with a SMALL area but present on
  // interactive elements: button, [type=submit], a.btn, .cta, [role=button], a:hover
  const accent = maxBy(
    clusters.filter(c => c !== dominant && c.oklch.c > 0.08),
    c => c.interactiveHits * 3 + c.contrastAgainst(dominant) - c.bgArea / totalBg * 10,
  );

  // SECONDARY: everything else that carries structure — text, cards, header, borders.
  // On a blue-gray site: dark-blue navigation, gray-blue text, cards.
  const secondary = maxBy(
    clusters.filter(c => c !== dominant && c !== accent),
    c => c.textArea + c.bgArea + c.borderArea,
  );
  // ...
}
```
The “interactivity” signal (`interactiveHits`): selectors containing `button`, `.btn`, `:hover`, `:focus`, `a`, `[type=submit]`, `.cta`, `[role="button"]`, `input[type=checkbox]:checked`, etc.

### 5.4 Manual correction
The heuristic won't always get it right. The UI must show the detected palette as chips grouped by role and allow **dragging a chip into another role** (`setRoleOverride`). Overrides are stored per domain (`localStorage` key `cc:<hostname>`).

---

## 6. Phase 3 — Mapping (old → new color)

This is the heart of the tool. **We don't replace all the shades of blue with one red** — that would destroy hover states, shadows, light badge backgrounds, etc. Instead we keep the **relative relationship** of each shade to the base color of its role.

### 6.1 Algorithm (relative shift in OKLCH)
```ts
// packages/core/src/map/remap.ts
export function remap(orig: OKLCH, oldBase: OKLCH, newBase: OKLCH): OKLCH {
  // 1. Lightness: keep the difference from the base, but scale it so it doesn't leave [0,1]
  const dL = orig.l - oldBase.l;
  const l = clamp(newBase.l + dL * lightnessScale(oldBase.l, newBase.l, dL), 0, 1);

  // 2. Chroma: proportional (a pale variant stays pale)
  const cRatio = oldBase.c > 0.001 ? orig.c / oldBase.c : 0;
  const c = newBase.c * cRatio;

  // 3. Hue: keep a small shift (e.g. blue moves slightly toward purple on hover)
  const dH = hueDelta(oldBase.h, orig.h);            // in [-180, 180]
  const h = (newBase.h + dH + 360) % 360;

  return gamutMap({ l, c, h, a: orig.a });           // lower C until it fits in sRGB
}

function lightnessScale(oldL: number, newL: number, dL: number) {
  // If the old base was L=0.45 and the shade L=0.95 (a light badge background),
  // and the new base is L=0.85 (yellow), there is only 0.15 of room upward → compress.
  const roomOld = dL > 0 ? 1 - oldL : oldL;
  const roomNew = dL > 0 ? 1 - newL : newL;
  return roomOld > 0 ? Math.min(1, roomNew / roomOld) : 1;
}
```

### 6.2 Neutral colors
- **Pure neutrals** (white, #f5f5f5, #333, black) — **stay** by default, unless the user picked them as dominant/secondary.
- **Tinted neutrals** (blue-grays: `#64748b`, `#f1f5f9` — typical Tailwind *slate*) — keep their `L` and `C`, but **take the hue of the new secondary color**. So “blue-gray” becomes “red-gray” or “green-gray” — exactly the effect we want.
- The `neutralTint` option (0–1) lets pure grays get a slight tint too.

### 6.3 If the user picks the dominant color
The dominant color (60%) is usually the background. If the new dominant is dark (`L < 0.4`) and the old one was light → this is a **switch to dark mode**: invert `L` for all neutrals (`l' = 1 - l`, with slight compression) so the text stays readable. This is an advanced option — in v1 it can be just a warning.

### 6.4 Contrast check (WCAG)
After mapping, for every (text ↔ background) pair recorded during scanning (from the element's computed style and its effective background):
```ts
if (contrast(newText, newBg) < 4.5 /* AA normal text; 3.0 for ≥24px or ≥18.66px bold */) {
  newText = adjustLightnessUntil(newText, newBg, 4.5); // move L toward black/white, H and C stay
}
```
Especially important for the **accent**: text on a CTA button (e.g. white on yellow fails → automatically switch to dark text). The UI shows a warning when it has to correct something.

### 6.5 Mapping result
One `Map<originalCssString, newCssString>` table, deterministic and cached. The same input palette → always the same output.

---

## 7. Phase 4 — Applying (non-destructively)

### 7.1 Strategy by priority
1. **CSS variables (cleanest):** if the site uses `--color-primary` etc. on `:root` or other selectors, the override is just:
   ```css
   :root { --color-primary: #e53935 !important; }
   ```
   Careful: a variable can also be defined in `@media (prefers-color-scheme: dark)` or on a `.dark` class — override it on **every** selector where it is defined.
2. **Override stylesheet (the main mechanism):** for every CSSOM rule that has a color, generate a rule with **the same selector** and **the same @media wrapper**, containing only the color properties:
   ```css
   /* original: .btn-primary:hover { background:#1d4ed8 url(x.png) no-repeat; padding:8px } */
   @media all {
     .btn-primary:hover { background-color: #c62828 !important; }
   }
   ```
   - For a `background` shorthand containing `url()`/a gradient → write the **whole** `background-image` with the colors replaced, but with `url()` and positions untouched.
   - `!important` is needed because our layer must beat the original specificity; since we use **the same selector**, we don't affect elements the original didn't affect.
   - If the original declaration is already `!important`, ours is too; the order (our `<style>` is last in `<head>`) breaks the tie.
   - Inject it as one `<style id="cc-override" data-cc>` at the end of `<head>`, or (better) `document.adoptedStyleSheets = [...existing, ccSheet]` — which doesn't touch the DOM at all.
3. **Inline styles:** `element.style` takes precedence over stylesheets. Patch them via `el.style.setProperty(prop, newVal, priority)` and **remember the original** in a `WeakMap<Element, Record<prop,string>>` for restoring. (This is the only case where we touch an element — and only the color value in an already existing `style` attribute.)
4. **SVG attributes** (`fill="#1e3a8a"`): override via CSS (`[fill="#1e3a8a" i] { fill: #c62828 !important }`) — a CSS property beats a presentation attribute, so here too we don't change the DOM.
5. **Computed fallback** (cross-origin CSS we can't read): generate rules with a selector based on an attribute we assign (`[data-cc-id="123"]`). This is the only time we add an attribute — only in bookmarklet mode and only when there is no other way. Log a warning.

### 7.2 Dynamic content (SPAs, modals, lazy loading)
```ts
// packages/core/src/apply/observer.ts
const mo = new MutationObserver((records) => {
  queueMicrotask(() => {
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach(n => n.nodeType === 1 && patchInline(n as Element));
      if (r.type === 'attributes' && r.attributeName === 'style') patchInline(r.target as Element);
    }
  });
});
mo.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });

// a new <style>/<link> (CSS-in-JS: styled-components, emotion) → rescan only that sheet
```
> Loop protection: ignore mutations produced by the engine itself (an `isApplying` flag).

### 7.3 Restoring (`disable`)
- remove `ccSheet` from `adoptedStyleSheets` / remove `<style data-cc>`
- restore the inline values from the `WeakMap`
- `mo.disconnect()`
- Test: after `disable()` the screenshot must be **pixel-identical** to the original.

### 7.4 What is NOT changed (explicitly)
- images, video, `<canvas>`, `<iframe>`s from other domains
- colors “baked” into SVG files loaded as `<img src="logo.svg">` (optionally later: `filter: hue-rotate()` only for icons the user marks)
- `transparent`, `currentColor`, `inherit` (they adapt on their own)

---

## 8. UI panel

- Render it in a **Shadow DOM** (`attachShadow({mode:'closed'})`) on a `<cc-panel>` host with `all: initial` → the site's styles don't affect the panel and vice versa. The engine **excludes** its own host from scanning.
- Elements:
  1. **Detected palette** — chips grouped into *Dominant / Secondary / Accent*, drag & drop for corrections.
  2. **Three color pickers** (`<input type="color">` + a HEX/OKLCH field).
  3. **Presets:** “Red/gray”, “Yellow/green”, “Green/cream”, “Orange/dark”, “Original”.
  4. **A/B switch** (or the `Alt+C` key) — instant switching between the original and the new palette.
  5. **Contrast indicator** — the number of warnings + a list of the pairs that were corrected.
  6. **Export:** “Copy CSS”, “Download theme-override.css”, “Copy link” (the palette in the URL hash: `#cc=ffffff,4a4a4a,e53935` → a colleague opens the same view).
- Live preview: `apply()` is debounced (~50ms) while a picker is being dragged; regenerating the map is cheap (only the remap table + regenerating the sheet text; the scan is **not** repeated).

### Preset examples
```ts
export const PRESETS: Record<string, Palette> = {
  'crveno-sivo':  { dominant: '#FAFAFA', secondary: '#4B4B4F', accent: '#D32F2F' },  // red/gray
  'zuto-zeleno':  { dominant: '#FFFDF5', secondary: '#2E5E3E', accent: '#F2B705' },  // yellow/green
  'zeleno-krem':  { dominant: '#FBF8F1', secondary: '#3A4A3F', accent: '#2E9E5B' },  // green/cream
  'narandzasto-tamno': { dominant: '#121212', secondary: '#D0D0D0', accent: '#FF7A1A' }, // orange/dark
};
```

---

## 9. CLI — permanent export for production

Once a variant is chosen, no script is needed in production — what's needed is **static CSS**.

```bash
npx cc-export https://my-site.com --palette "#FAFAFA,#4B4B4F,#D32F2F" \
  --pages / /contact /shop --out theme-override.css
```
- Playwright opens every page (both mobile and desktop viewports), injects the core, runs `analyze()` + `exportCss()`, merges the results and removes duplicates.
- An alternative for projects with source CSS: a **PostCSS plugin** `postcss-cc-remap` that applies the same map directly to the source `.css`/`.scss` files (it produces a new version of the file — the original stays in git).
- All that is added to the site: `<link rel="stylesheet" href="theme-override.css">` after the existing styles.

---

## 10. Testing

### Unit (Vitest)
- `parse/serialize`: all CSS color syntaxes, lossless round-trip.
- `replaceColors`: `background: url(a#fff.png) #fff no-repeat` → changes only the second `#fff`.
- `remap`: monotonicity — if `A` is lighter than `B` before mapping, it must be after it too.
- `contrast`: known pairs (black/white = 21:1).
- `classify`: synthetic sets (typical Bootstrap, Tailwind slate+blue, Material).

### E2E (Playwright) on `fixtures/`
| Fixture | What it checks |
|---|---|
| `blue-gray-vars/` | a site with CSS variables |
| `blue-gray-plain/` | hard-coded HEX values, no variables |
| `tailwind/` | utility classes, `hover:` variants |
| `bootstrap-cdn/` | cross-origin stylesheet |
| `spa-react/` | dynamic content, CSS-in-JS |
| `inline-svg/` | `fill` attributes, inline `style` |

Assertions:
1. **Structure untouched:** `document.body.outerHTML` (without our host) identical before and after `apply()`.
2. **Layout untouched:** `getBoundingClientRect()` of all elements identical before/after.
3. **Functionality:** clicking buttons/forms works the same (event listeners untouched).
4. **Reversibility:** the screenshot after `disable()` === the screenshot of the original (`toHaveScreenshot` with `maxDiffPixels: 0`).
5. **60-30-10 check:** measure the area share per role after applying — log it, warn if the accent > 15%.
6. **Contrast:** the axe-core `color-contrast` rule must not report new errors compared to the original.

---

## 11. Edge cases (checklist)

- [ ] `@media (prefers-color-scheme: dark)` — map the dark variant too (a separate palette or derived automatically)
- [ ] `:hover`, `:focus-visible`, `:active`, `:disabled`, `::selection`, `::placeholder`, `::marker`
- [ ] gradients with multiple stops, `color-mix()`, `rgb(from var(--x) r g b / .5)` (relative colors)
- [ ] colors with alpha (`rgba(30,58,138,.1)` → keep the alpha)
- [ ] `transition: background-color` — our override must not trigger an animation when turned on (temporarily `* { transition: none !important }` during the first `apply`, then remove it)
- [ ] `@layer` — our sheet outside the layers beats all layered styles (good)
- [ ] Shadow DOM web components — scan `shadowRoot`s (open ones); closed ones are not accessible → warning
- [ ] same-origin iframes — optionally recursive
- [ ] strict CSP (`style-src` without `'unsafe-inline'`) → use `adoptedStyleSheets` (not blocked by CSP like `<style>`), or the extension
- [ ] `<meta name="theme-color">` — offer an optional change (the only meta attribute worth changing; default: off)
- [ ] performance: target < 300 ms analysis for a page with 3000 elements, < 16 ms `apply()` after the first analysis

---

## 12. Work plan (milestones)

| # | Milestone | Deliverable | Estimate |
|---|---|---|---|
| M1 | Color core | `parse`, `convert` (OKLCH), `contrast`, `replaceColors` + unit tests | 2–3 days |
| M2 | Scanner | CSSOM + inline + variables + area weighting; print the detected palette to the console | 3–4 days |
| M3 | Classification + remap | 60/30/10 heuristic, relative mapping, contrast correction | 3–4 days |
| M4 | Applying | override sheet, inline patch, observer, `disable()`; structure/reversibility e2e tests | 3 days |
| M5 | UI panel + bookmarklet | Shadow DOM panel, presets, A/B, URL hash sharing | 3 days |
| M6 | Extension | MV3, cross-origin CSS fetch, per-domain memory | 2 days |
| M7 | CLI export | Playwright export + (optional) PostCSS plugin | 2–3 days |

**MVP = M1–M5** (~2.5–3 weeks for one developer): a bookmarklet that gives three pickers on your blue-gray site, the “red/gray” and “yellow/green” presets, an A/B switch and CSS export.

---

## 13. Code conventions

- TypeScript `strict: true`, no `any` in the public API.
- The core must not depend on the UI; the UI depends only on the `ColorEngine` interface.
- All functions in `color/` and `map/` are **pure** (no DOM) → 100% unit coverage.
- Every DOM write goes through one module (`apply/`) — easy to audit that nothing else touches the site.
- Prefix for everything we inject into the page: `cc-` / `data-cc` (easy to find and clean up).
- Bundle for the bookmarklet/inject: target < 40 KB gzip.

---

## 14. Implementation notes

All seven milestones (M1–M7) are implemented. Where the code differs from this plan, it is deliberate:

| Plan | Implementation | Why |
|---|---|---|
| `culori`, Vite | own OKLCH/Lab/P3 conversions and gamut mapping; esbuild | zero runtime dependencies, small bundle |
| `Role` with `'neutral-text'` | `'dominant' \| 'secondary' \| 'accent' \| 'protected'`, with a reason code per color | semantic colors, chart colors, masks, shadows and logos must not change |
| override rules with `!important` | the importance and the `@layer`/`@media`/`@supports`/nesting wrappers of the original are mirrored; the layer goes into `adoptedStyleSheets` | the cascade stays exactly as on the site; `!important` would also override the site's own JS-set inline styles |
| SVG attributes via `[fill=…]` CSS | the attribute is patched and restored byte-identically | an attribute selector in our layer could beat the site's own CSS that originally won over the attribute |
| computed fallback via `data-cc-id` | inline `style` patch, restored on `disable()` | no extra attributes |
| closed Shadow DOM | open Shadow DOM | same style isolation; the panel can be tested |
| drag & drop for roles | a menu with a drop-down list | works with the keyboard |
| dark mode only as a warning | full light ↔ dark polarity flip; the site's own dark mode is mapped through its own base colors | the dark presets needed it |
| axe-core for contrast | own audit of every visible text against `min(AA, original contrast)` | also checks the exported CSS without the tool |
| fixtures `tailwind/`, `bootstrap-cdn/`, `spa-react/` | `blue-gray-vars`, `blue-gray-plain`, `cross-origin`, `shadow-dom`, `strict-csp`, `multi` and a static snapshot of drmozgovich.top | covers the same cases; drmozgovich.top is the main test site |
| — | text on CTA buttons that shares the body text color is fixed locally (a dedicated variable if a probe proves it controls the color, otherwise only on those elements) | it can't be fixed globally without darkening all text |

The current architecture and usage are described in the [README](../README.md).
