# website_color_changer
Aplication that can change finished websites colour scheme

Alat koji menja paletu boja gotovog sajta (pravilo 60-30-10) bez izmene njegove strukture i funkcionalnosti.

📘 Tehnička specifikacija i plan implementacije: [docs/UPUTSTVO-ZA-KODIRANJE.md](docs/UPUTSTVO-ZA-KODIRANJE.md)

## Razvoj

```bash
npm install
npm test          # unit testovi (Vitest)
npm run e2e       # skener na test sajtovima iz fixtures/ (Playwright + Chromium)
LIVE=1 npm run e2e   # + test nad živim drmozgovich.top
npm run typecheck
```

### Skeniranje pravog sajta

```bash
npx playwright install chromium   # jednom, lokalno
npm run scan -- https://moj-sajt.rs --json paleta.json
```

Sa `--palette crveno-sivo` (ili `--palette "#FAFAFA,#4B4B4F,#D32F2F"`) dodatno prikazuje klasifikaciju 60-30-10 i mapu stara → nova boja, sa korekcijama kontrasta. Preseti: `crveno-sivo`, `zuto-zeleno`, `zeleno-krem`, `narandzasto-tamno`.

Dodaj `--screenshot snimci/` za snimke cele stranice pre i posle, i `--css paleta.css` za izvoz CSS sloja koji se trajno dodaje posle stilova sajta.

![drmozgovich.top: original, crveno-sivo, žuto-zeleno, zeleno-krem, narandžasto-tamno](docs/screenshots/drmozgovich-top.jpg)

Ispisuje detektovanu paletu sa uzorcima boja, udelom u površini ekrana (pozadina / tekst / ivice / interaktivni elementi), mestima gde je boja deklarisana i CSS varijablama koje je nose. Opcije: `--width 390` (mobilni prikaz), `--dark` (`prefers-color-scheme: dark`), `--no-scroll`.

U browser konzoli (bez instalacije): ubaci `packages/core/dist/cc-core.iife.js` (`npm run build -w @cc/core`), pa:

```js
CC.printPalette(await CC.scanDocument(document));    // samo paleta
const engine = CC.createEngine(document);
await engine.analyze();
engine.apply(CC.PRESETS['crveno-sivo']);             // ili { dominant, secondary, accent }
engine.toggle();                                     // A/B: original ↔ nova paleta
console.log(engine.exportCss());                     // CSS za trajnu primenu
```

| Faza | Status |
|---|---|
| M1 — Color core (`packages/core/src/color`): parse, OKLCH konverzije, gamut mapping, kontrast, `replaceColors` | ✅ |
| M2 — Skener (`packages/core/src/scan`): CSSOM (+ `@import`, `@media`, `@layer`, nesting, `@keyframes`, cross-origin), inline stilovi, SVG/HTML atributi, CSS varijable, shadow DOM, ponder površine, parovi za kontrast | ✅ |
| M3 — Klasifikacija 60/30/10 (`src/analyze`) + remap i korekcija kontrasta (`src/map`); glavni test sajt: snimak drmozgovich.top (`fixtures/drmozgovich`, `test/fixtures/drmozgovich.scan.json`) | ✅ |
| M4 — Primena (`src/apply`, `src/engine.ts`): CSS sloj u `adoptedStyleSheets` (isti selektori/slojevi/media), inline/SVG atributi sa tačnim vraćanjem, lokalna korekcija kontrasta (CTA), computed fallback za CORS, MutationObserver, `toggle()`/`disable()`/`exportCss()` | ✅ |
| M5 — UI panel + bookmarklet | ⏳ |
