# Website Color Changer

A tool for previewing alternative color palettes on an existing website using the 60-30-10 rule. Previews are local and reversible: the tool does not modify the original website's source files or server. Export the chosen palette as CSS and add it to your website when you are ready to make the changes permanent.

👉 **For users:** [Beginner's guide: the Chrome and Firefox extension](docs/USER-GUIDE.md). Ready-to-install files are in the [`downloads/`](downloads/) folder; the English versions have `_en` in the name:

| File | For |
|---|---|
| [`website-color-changer-chrome_en.zip`](downloads/website-color-changer-chrome_en.zip) | Chrome, Edge, Brave, Opera |
| [`website-color-changer-firefox_en.zip`](downloads/website-color-changer-firefox_en.zip) | Firefox |
| [`bookmarklet_en.html`](downloads/bookmarklet_en.html) | the bookmarklet (download it and open it in your browser) |

### The 60-30-10 rule

| Role | Share | Typically |
|---|---|---|
| **Dominant** | 60% | backgrounds |
| **Secondary** | 30% | text, cards, structure |
| **Accent** | 10% | calls to action: “Buy now”, “Sign up”, links |

You pick three colors (or a ready-made palette) and the tool maps every color of the site to the new palette. Each shade keeps its relation to the base color of its role, so hover states stay darker and light tints stay light. Text contrast is kept at WCAG AA (never above what the original had). The site's own dark mode, semantic colors (errors, success, charts) and other companies' logos are handled separately. The change is a reversible layer: the site's HTML and JavaScript are not modified.

![drmozgovich.top: original, red/gray, yellow/green, green/cream, orange/dark](docs/screenshots/drmozgovich-top.jpg)

![drmozgovich.top: purple/pink, teal/ocean, terracotta/sand, graphite/electric blue, midnight/gold](docs/screenshots/drmozgovich-nove-palete.jpg)

### Panel in the browser (bookmarklet)

```bash
npm install
npm run build -w @cc/ui        # → packages/ui/dist/install_en.html (English), install.html (Serbian)
```

Open `packages/ui/dist/install_en.html` (or [`downloads/bookmarklet_en.html`](downloads/bookmarklet_en.html)) and drag the “🎨 Site colors” button to your bookmarks bar. On any website, clicking it opens the panel:

- **Site colors** — the detected palette grouped by role (60 / 30 / 10 / unchanged); click a color to change its role (remembered per domain).
- **New palette** — three color pickers (color picker + HEX) with a live preview, plus **Brightness** and **Contrast** sliders. The sliders change only the new colors (in OKLCH lightness, so images stay untouched); text contrast never drops below WCAG AA.
- **Ready-made palettes** — Original and 9 combinations: Red/gray, Yellow/green, Green/cream, Orange/dark, Purple/pink, Teal/ocean, Terracotta/sand, Graphite/electric blue, Midnight/gold.
- **Show original / new palette** — A/B comparison, shortcut <kbd>Alt+C</kbd>.
- **Export** — copy or download the CSS for permanent use; “Copy link” gives a URL with the palette (`#cc=fafafa,4b4b4f,d32f2f`, with the sliders `#cc=fafafa,4b4b4f,d32f2f,10,-20`).

Closing the panel (×) restores the original site. The whole tool is inside the link (~100 KB); nothing is loaded from the internet.

On your own site (dev/staging) it can also run as a snippet that visitors don't see — the panel only appears with `?cc=1` or `#cc=…` in the URL:

```html
<script src="/cc-panel_en.min.js" data-cc-snippet defer></script>
```

![The panel on drmozgovich.top](docs/screenshots/guide/panel-parts.png)

### Chrome and Firefox extension

```bash
npm run build -w @cc/extension   # → packages/extension/dist/{chrome,firefox}_en (English), {chrome,firefox} (Serbian) + .zip
```

- **Chrome / Edge:** `chrome://extensions` → turn on *Developer mode* → *Load unpacked* → choose `packages/extension/dist/chrome_en`.
- **Firefox (140+):** `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* → choose `packages/extension/dist/firefox_en/manifest.json`. For a permanent install the zip has to be signed on addons.mozilla.org.

Clicking the icon opens the same panel as the bookmarklet, with these differences:

| | Bookmarklet | Extension |
|---|---|---|
| Sites with a strict CSP | often blocked | works (the browser injects the code) |
| CSS from another domain without CORS | computed fallback (inline) | fetches the CSS, maps it through the CSS layer ¹ |
| Where palettes are stored | the site's `localStorage` | extension storage, listed in the settings |
| Automatic apply on page load | — | per site, switch in the panel ¹ |

¹ With the “access to all sites” permission, which is turned on in the extension's settings. Without it the extension only works on click (`activeTab`) and sees nothing else. The extension sends no data outside the browser. It fetches cross-origin CSS without cookies, only for stylesheets the page actually loads, only with `Content-Type: text/css`, and never from a private network for a page on another host.

### Production export (`cc-export`)

Once you have chosen a palette, the tool is no longer needed in production. One CSS file, included after the site's existing styles, is enough.

```bash
npm run build -w @cc/cli
node packages/cli/dist/cli.mjs https://drmozgovich.top --palette red-gray \
  --crawl 10 --out theme-override.css --map palette.map.json --report report.json --screenshots shots/
```

1. Visits pages (`--pages /,/contact` or `--crawl N` following same-domain links) in desktop and mobile viewports (`--viewports 1440,390`).
2. Merges the findings and classifies and maps the colors **once** for the whole site, so every page gets the same map. Each page and viewport has the same weight.
3. On each page, finds local contrast fixes (e.g. text on CTA buttons) and turns them into verified CSS rules.
4. Writes one `theme-override.css` (HEX colors, the same selectors, `@layer`, `@media` and dark mode as the site).
5. **Verification:** the CSS is added to every page as a plain stylesheet, without the tool, and the contrast of every visible text is measured. Elements that kept an old color (e.g. because of inline styles) are reported too. If any text loses contrast, the command exits with code 2, so it can be used in CI.

Other options: `--brightness <-100…100>` and `--contrast <-100…100>` (the panel's sliders), `--override "#e7f2fa=dominant"`, `--all-colors` (also changes semantic and chart colors), `--no-verify`, `--wait <ms>`. Colors in multicolor SVG graphics (e.g. the Google logo) are never changed. Palette names on the command line: `red-gray`, `yellow-green`, `green-cream`, `orange-dark`, `purple-pink`, `teal-ocean`, `terracotta-sand`, `graphite-blue`, `midnight-gold` (the Serbian names such as `crveno-sivo` work too). Messages and the comments in the generated CSS follow `--lang en|sr` (default: the system language).

#### Directly in the source files (PostCSS)

If you prefer to change the colors in the project's own CSS/SCSS files instead of adding a layer, use the map from `--map`:

```js
// postcss.config.js
import ccRemap from 'postcss-cc-remap';
export default {
  plugins: [ccRemap({ map: './palette.map.json', localRules: 'append' /* only for the main stylesheet */ })],
};
```

The plugin only changes values of declarations that carry a color: color properties, shorthands, `--css` and `$scss` variables. `url()`, strings, selectors and other properties stay untouched. A test confirms that the `cc-export` layer and the source CSS rewritten this way produce the same colors on the page.

### Development

```bash
npm install
npm test             # unit tests (Vitest)
npm run e2e          # Playwright + Chromium on the sites in fixtures/
LIVE=1 npm run e2e   # + tests against the live drmozgovich.top
npm run lint:firefox # web-ext lint for the Firefox builds
npm run typecheck
```

In the browser console (no install): inject `packages/core/dist/cc-core.iife.js` (`npm run build -w @cc/core`), then:

```js
CC.printPalette(await CC.scanDocument(document), console, 'en'); // just the palette
const engine = CC.createEngine(document, { lang: 'en' });
await engine.analyze();
engine.apply(CC.findPreset('red-gray'));             // or { dominant, secondary, accent }
engine.toggle();                                     // A/B: original ↔ new palette
console.log(engine.exportCss());                     // CSS for permanent use
```

| Package | Contents |
|---|---|
| `packages/core` | color math (OKLCH, gamut mapping, WCAG contrast), scanner, 60-30-10 classification, remapping, the engine that applies the palette as a reversible layer |
| `packages/ui` | the floating panel (Shadow DOM), bookmarklet and snippet mode — Serbian and English builds |
| `packages/extension` | Manifest V3 extension for Chrome and Firefox — Serbian and English builds |
| `packages/cli` | `cc-export`: multi-page production export with verification |
| `packages/postcss-cc-remap` | PostCSS plugin that applies the color map to source CSS/SCSS |

Technical specification: [docs/TECHNICAL-SPEC.md](docs/TECHNICAL-SPEC.md) (Serbian: [UPUTSTVO-ZA-KODIRANJE.md](docs/UPUTSTVO-ZA-KODIRANJE.md)).
