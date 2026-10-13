# Website Color Changer — uputstvo za kodiranje

> Tehnička specifikacija i plan implementacije alata koji menja paletu boja **već gotovog sajta**, bez izmene njegove strukture, HTML-a, JS logike i funkcionalnosti — po pravilu **60-30-10**.

---

## 1. Cilj i ograničenja

### Šta alat radi
1. Učita se na bilo koji gotov sajt (bez izmene njegovog koda).
2. **Otkrije postojeću paletu** (npr. plavo-sive nijanse).
3. **Klasifikuje boje u tri uloge** po pravilu 60-30-10:
   | Uloga | Udeo | Tipično na sajtu |
   |---|---|---|
   | **Dominantna (60%)** | pozadine | `body`, sekcije, header/footer pozadine |
   | **Sekundarna (30%)** | struktura | tekst, kartice, ivice, navigacija, ikone |
   | **Akcentna (10%)** | konverzija | CTA dugmad, linkovi, badge-ovi, fokus stanja |
4. Korisnik izabere **tri nove boje** (ili gotov preset: „crveno/sivo", „žuto/zeleno"...).
5. Alat **mapira svaku staru nijansu na novu**, čuvajući odnose svetline (hover tamniji, disabled svetliji, itd.).
6. Primenjuje se **kao sloj preko sajta** — isključivanjem sloja sajt je identičan originalu.

### Tvrda pravila (ne pregovara se)
- ❌ Ne menja se DOM struktura, klase, ID-jevi, atributi (osim našeg jednog `<style>` taga i našeg UI-ja u Shadow DOM-u).
- ❌ Ne menja se postojeći JS, event handleri, layout, tipografija, razmaci, veličine.
- ❌ Ne diraju se slike (`<img>`, `background-image: url()`), video, canvas — samo CSS boje (opciono SVG, vidi §7).
- ✅ Menjaju se **isključivo vrednosti boja** u CSS svojstvima.
- ✅ Potpuno reverzibilno: `disable()` vraća sajt u originalno stanje bez reload-a.

---

## 2. Arhitektura

Jedno jezgro (core) bez zavisnosti od okruženja + tanki „adapteri" za isporuku.

```
website_color_changer/
├── packages/
│   ├── core/                  # čista logika, bez DOM UI-a
│   │   ├── src/
│   │   │   ├── color/
│   │   │   │   ├── parse.ts         # string → RGBA (hex, rgb, hsl, oklch, named, color-mix)
│   │   │   │   ├── convert.ts       # RGB ↔ OKLCH (i obrnuto), gamut mapping
│   │   │   │   ├── contrast.ts      # WCAG 2.x kontrast + APCA (opciono)
│   │   │   │   └── serialize.ts     # RGBA → CSS string
│   │   │   ├── scan/
│   │   │   │   ├── cssom-scanner.ts     # čita stylesheet pravila
│   │   │   │   ├── computed-scanner.ts  # fallback: getComputedStyle po elementu
│   │   │   │   ├── variables-scanner.ts # CSS custom properties (--primary...)
│   │   │   │   └── area-weigher.ts      # koliko piksela pokriva koja boja
│   │   │   ├── analyze/
│   │   │   │   ├── cluster.ts       # grupisanje sličnih nijansi
│   │   │   │   └── classify.ts      # dodela uloga 60/30/10
│   │   │   ├── map/
│   │   │   │   └── remap.ts         # stara boja → nova boja (čuva relacije)
│   │   │   ├── apply/
│   │   │   │   ├── override-sheet.ts    # generiše i ubacuje <style>
│   │   │   │   ├── inline-patcher.ts    # inline style="color:..." elementi
│   │   │   │   └── observer.ts          # MutationObserver za dinamički sadržaj
│   │   │   ├── engine.ts            # javni API (vidi §3)
│   │   │   └── types.ts
│   │   └── test/
│   ├── ui/                    # plutajući panel (Shadow DOM, izolovan od sajta)
│   ├── bookmarklet/           # build → javascript:... link
│   ├── extension/             # Chrome/Firefox MV3 ekstenzija
│   └── cli/                   # Playwright + PostCSS: izvoz trajnog CSS-a
├── fixtures/                  # test sajtovi (plavo-sivi, sa varijablama, bez varijabli, Tailwind, Bootstrap)
└── docs/
```

**Stack:** TypeScript, Vite (library mode, IIFE build za bookmarklet/inject), Vitest (unit), Playwright (e2e + vizuelna regresija). Za konverzije boja: [`culori`](https://culorijs.org/) (mali, tree-shakeable) — ili sopstvena implementacija OKLCH (~150 linija) ako želimo nula zavisnosti.

### Načini isporuke (isto jezgro)
| Adapter | Kada | Napomena |
|---|---|---|
| **Bookmarklet** | brzo testiranje na bilo kom sajtu | ograničen CSP-om nekih sajtova |
| **Browser ekstenzija** | glavni alat za testiranje | zaobilazi CSP i CORS za stylesheet-ove |
| **`<script>` snippet** | dev/staging okruženje sopstvenog sajta | `?cc=1` u URL-u da se uključi |
| **CLI (izvoz)** | kad se izabere varijanta → trajni `theme-override.css` | ide u produkciju kao jedan dodatni CSS fajl |

---

## 3. Javni API jezgra

```ts
// packages/core/src/types.ts
export type Role = 'dominant' | 'secondary' | 'accent' | 'neutral-text';

export interface Palette {
  dominant: string;   // npr. '#FFFFFF' ili '#121212' (dark)
  secondary: string;  // npr. '#4A4A4A'
  accent: string;     // npr. '#E53935'
}

export interface ColorToken {
  original: string;          // tačan string iz CSS-a
  oklch: { l: number; c: number; h: number; a: number };
  role: Role;
  area: number;              // ponder: pikseli površine (pozadine) ili broj glifova (tekst)
  usages: Usage[];           // gde se javlja
}

export interface Usage {
  source: 'cssom' | 'inline' | 'variable' | 'computed' | 'svg-attr';
  selector?: string;         // za cssom
  property: string;          // 'background-color', 'border-top-color', '--brand', ...
  media?: string;            // @media uslov ako postoji
  element?: WeakRef<Element>;// za inline/computed
}

export interface Analysis {
  tokens: ColorToken[];
  detected: Palette;         // šta alat misli da je trenutna 60/30/10 paleta
}

export interface EngineOptions {
  preserveNeutrals?: boolean;   // default true: belu/crnu/sive ne boji (samo blagi tint, vidi §6)
  neutralTint?: number;         // 0..1, koliko neutralne preuzmu nijansu nove sekundarne (default 0.0)
  enforceContrast?: 'AA' | 'AAA' | false; // default 'AA'
  includeSvg?: boolean;         // default true
  observeMutations?: boolean;   // default true
}

export interface ColorEngine {
  analyze(): Promise<Analysis>;
  setRoleOverride(original: string, role: Role): void; // ručna korekcija klasifikacije
  apply(palette: Palette): void;
  disable(): void;               // vraća original (uklanja sloj)
  toggle(): void;                // A/B poređenje
  exportCss(): string;           // trajni override CSS
  destroy(): void;
}

export function createEngine(doc: Document, opts?: EngineOptions): ColorEngine;
```

---

## 4. Faza 1 — Skeniranje boja

### 4.1 Zašto CSSOM, a ne samo `getComputedStyle`
`getComputedStyle` vidi **samo trenutno stanje** — ne vidi `:hover`, `:focus`, `:active`, `:disabled`, `@media (prefers-color-scheme)`, mobilne breakpoint-ove, ni elemente koji još nisu na stranici (modal, dropdown). Zato je **primarni izvor CSSOM** (pravila iz stylesheet-ova), a computed style je fallback i izvor „težine" (površine).

### 4.2 Svojstva koja nose boju
```ts
// packages/core/src/scan/properties.ts
export const COLOR_PROPS = [
  'color', 'background-color', 'background', 'background-image', // gradijenti!
  'border-color', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color', 'border',
  'outline-color', 'outline', 'text-decoration-color', 'text-emphasis-color',
  'column-rule-color', 'caret-color', 'accent-color',
  'box-shadow', 'text-shadow',
  'fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color',
  'scrollbar-color', '-webkit-text-fill-color', '-webkit-tap-highlight-color',
] as const;
```
Shorthand-ovi (`background`, `border`, `box-shadow`, gradijenti) sadrže boje **unutar** dužeg stringa → koristi tokenizer koji vadi samo boje i vraća ih nazad na **isto mesto** (ostatak stringa — `url()`, pozicije, debljine — ostaje netaknut).

```ts
// packages/core/src/color/parse.ts
const COLOR_RE =
  /#(?:[0-9a-f]{3,4}){1,2}\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|\b(?:transparent|currentcolor|[a-z]+)\b/gi;

/** Zameni svaku boju u vrednosti pozivom fn, ostatak stringa ostaje bajt-identičan. */
export function replaceColors(value: string, fn: (c: string) => string): string {
  return value.replace(COLOR_RE, (m) => {
    if (/^(transparent|currentcolor|inherit|initial|unset)$/i.test(m)) return m;
    if (/^[a-z]+$/i.test(m) && !NAMED_COLORS.has(m.toLowerCase())) return m; // 'solid', 'none'...
    if (/url\(/i.test(m)) return m;
    return fn(m);
  });
}
```
> ⚠️ Ne zamenjuj ništa unutar `url(...)` — prvo izdvoji `url()` segmente, pa tokenizuj ostatak.

### 4.3 CSSOM skener
```ts
// packages/core/src/scan/cssom-scanner.ts
export async function scanStylesheets(doc: Document): Promise<Usage[]> {
  const out: Usage[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;               // baca SecurityError za cross-origin CSS
    } catch {
      rules = await refetchSheet(sheet);    // vidi 4.4
      if (!rules) continue;
    }
    walkRules(rules, out, /*media*/ undefined);
  }
  // Shadow DOM web komponente: adoptedStyleSheets + <style> unutar shadowRoot-a
  for (const host of findShadowHosts(doc)) { /* isto, po shadowRoot-u */ }
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
    // @keyframes: CSSKeyframesRule → i animirane boje se mapiraju
  }
}
```

### 4.4 Cross-origin stylesheet-ovi (CDN, Google Fonts, Bootstrap sa CDN-a)
- **Ekstenzija:** `fetch(sheet.href)` iz background service worker-a (ima host permisije) → parsiraj tekst u `new CSSStyleSheet()` putem `replaceSync()` → čitaj pravila.
- **Bookmarklet/snippet:** probaj `fetch(href, {mode:'cors'})`; ako ne uspe, pređi na **computed fallback** samo za elemente pogođene tim fajlom.

### 4.5 Inline stilovi i SVG atributi
```ts
doc.querySelectorAll<HTMLElement>('[style]')         // style="background:#1e3a8a"
doc.querySelectorAll('[fill],[stroke],[stop-color]') // <path fill="#1e3a8a">
doc.querySelectorAll('[bgcolor],[color]')            // legacy <td bgcolor>, <font color>
```

### 4.6 Ponderisanje površinom (ključno za 60-30-10)
Broj pojavljivanja u CSS-u **ne govori** koja je boja dominantna. Treba izmeriti koliko ekrana pokriva:

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

    // pozadina: oduzmi površinu dece koja imaju sopstvenu neprovidnu pozadinu (vidljiva površina)
    const bg = cs.backgroundColor;
    if (alpha(bg) > 0.05) add(acc, norm(bg), 'bgArea', visibleArea(el, area));

    // tekst: broj karaktera × font-size² (približna „mastila")
    const text = ownText(el);
    if (text) add(acc, norm(cs.color), 'textArea', text.length * parseFloat(cs.fontSize) ** 2 * 0.5);

    // ivice: obim × debljina
    // ...
  }
  return acc;
}
```
> Skeniraj ceo dokument (ne samo viewport) — `getBoundingClientRect` radi i za elemente ispod pregiba. Za vrlo velike stranice (>5000 elemenata) uzorkuj ili radi u `requestIdleCallback` delovima.

---

## 5. Faza 2 — Analiza i klasifikacija (60-30-10)

### 5.1 Radi u OKLCH prostoru
OKLCH je perceptualno ujednačen: `L` = svetlina (0–1), `C` = zasićenost (hroma), `H` = nijansa (0–360°). To omogućava da „plava 500" postane „crvena 500" sa **istom vizuelnom težinom** — što HSL ne garantuje (žuta i plava sa istim HSL L izgledaju potpuno različito svetlo).

### 5.2 Klasterovanje
1. Normalizuj sve boje u OKLCH; zanemari alfa za klasterovanje (ali je pamti).
2. **Neutralne:** `C < 0.03` → posebna grupa (bele, sive, crne). Plavo-sive (`C` 0.01–0.05, `H` ≈ 250°) su „obojene neutralne" — pamti da imaju tint, jer se i on menja.
3. **Hromatske:** grupiši po nijansi `H` (prozor ±20°), zatim unutar grupe po `L`. Jednostavan pristup: k-means sa ΔE_OK < 0.04 kao prag spajanja.
4. Svaki klaster dobija **baznu boju** = boja sa najvećom težinom u klasteru.

### 5.3 Dodela uloga (heuristika)
```ts
// packages/core/src/analyze/classify.ts
export function classify(clusters: Cluster[], usage: UsageStats): Palette & { roles: Map<Cluster, Role> } {
  // DOMINANT: klaster sa najvećom bgArea (gotovo uvek neutralna: bela/svetlosiva ili tamna)
  const dominant = maxBy(clusters, c => c.bgArea);

  // ACCENT: hromatski klaster (C > 0.08) sa MALOM površinom ali prisutan na
  // interaktivnim elementima: button, [type=submit], a.btn, .cta, [role=button], a:hover
  const accent = maxBy(
    clusters.filter(c => c !== dominant && c.oklch.c > 0.08),
    c => c.interactiveHits * 3 + c.contrastAgainst(dominant) - c.bgArea / totalBg * 10,
  );

  // SECONDARY: sve ostalo što nosi strukturu — tekst, kartice, header, ivice.
  // Na plavo-sivom sajtu: tamnoplava navigacija, sivoplavi tekst, kartice.
  const secondary = maxBy(
    clusters.filter(c => c !== dominant && c !== accent),
    c => c.textArea + c.bgArea + c.borderArea,
  );
  // ...
}
```
Signal za „interaktivnost" (`interactiveHits`): selektori koji sadrže `button`, `.btn`, `:hover`, `:focus`, `a`, `[type=submit]`, `.cta`, `[role="button"]`, `input[type=checkbox]:checked` itd.

### 5.4 Ručna korekcija
Heuristika neće uvek pogoditi. UI mora da prikaže detektovanu paletu kao čipove grupisane po ulozi i omogući **drag & drop čipa u drugu ulogu** (`setRoleOverride`). Override-i se čuvaju po domenu (`localStorage` ključ `cc:<hostname>`).

---

## 6. Faza 3 — Mapiranje (stara → nova boja)

Ovo je srce alata. **Ne zamenjujemo sve nijanse plave jednom crvenom** — to bi uništilo hover stanja, senke, svetle pozadine badge-ova itd. Umesto toga čuvamo **relativni odnos** svake nijanse prema baznoj boji njene uloge.

### 6.1 Algoritam (relativno pomeranje u OKLCH)
```ts
// packages/core/src/map/remap.ts
export function remap(orig: OKLCH, oldBase: OKLCH, newBase: OKLCH): OKLCH {
  // 1. Svetlina: zadrži razliku u odnosu na baznu, ali skaliraj da ne izleti iz [0,1]
  const dL = orig.l - oldBase.l;
  const l = clamp(newBase.l + dL * lightnessScale(oldBase.l, newBase.l, dL), 0, 1);

  // 2. Hroma: proporcionalno (bleda varijanta ostaje bleda)
  const cRatio = oldBase.c > 0.001 ? orig.c / oldBase.c : 0;
  const c = newBase.c * cRatio;

  // 3. Nijansa: zadrži mali pomak (npr. plava ide malo ka ljubičastoj na hover-u)
  const dH = hueDelta(oldBase.h, orig.h);            // u [-180, 180]
  const h = (newBase.h + dH + 360) % 360;

  return gamutMap({ l, c, h, a: orig.a });           // spusti C dok ne uđe u sRGB
}

function lightnessScale(oldL: number, newL: number, dL: number) {
  // Ako je stara bazna bila L=0.45 i nijansa L=0.95 (svetla pozadina badge-a),
  // a nova bazna je L=0.85 (žuta), prostor naviše je samo 0.15 → kompresuj.
  const roomOld = dL > 0 ? 1 - oldL : oldL;
  const roomNew = dL > 0 ? 1 - newL : newL;
  return roomOld > 0 ? Math.min(1, roomNew / roomOld) : 1;
}
```

### 6.2 Neutralne boje
- **Čiste neutralne** (bela, #f5f5f5, #333, crna) — po defaultu **ostaju**, osim ako ih korisnik nije odabrao kao dominantnu/sekundarnu.
- **Obojene neutralne** (plavo-sive: `#64748b`, `#f1f5f9` — tipičan Tailwind *slate*) — zadrže svoj `L` i `C`, a **nijansu preuzmu od nove sekundarne boje**. Tako „plavo-siva" postaje „crveno-siva" ili „zeleno-siva" — upravo efekat koji tražiš.
- Opcija `neutralTint` (0–1) dozvoljava da i čiste sive dobiju blagi tint.

### 6.3 Ako korisnik bira dominantnu boju
Dominantna (60%) je najčešće pozadina. Ako je nova dominantna tamna (`L < 0.4`) a stara svetla → to je **prelazak u dark mode**: invertuj `L` za sve neutralne (`l' = 1 - l`, uz blagu kompresiju) da bi tekst ostao čitljiv. Ovo je napredna opcija — u v1 može samo upozorenje.

### 6.4 Provera kontrasta (WCAG)
Posle mapiranja, za svaki par (tekst ↔ pozadina) koji je zabeležen u fazi skeniranja (iz computed stila elementa i njegove efektivne pozadine):
```ts
if (contrast(newText, newBg) < 4.5 /* AA normal text; 3.0 za ≥24px ili ≥18.66px bold */) {
  newText = adjustLightnessUntil(newText, newBg, 4.5); // pomeraj L ka crnoj/beloj, H i C ostaju
}
```
Posebno važno za **akcent**: tekst na CTA dugmetu (npr. bela na žutoj ne prolazi → automatski prebaci na tamni tekst). UI prikazuje upozorenje kad mora da koriguje.

### 6.5 Rezultat mapiranja
Jedna tabela `Map<originalCssString, newCssString>`, deterministička i keširana. Ista ulazna paleta → uvek isti izlaz.

---

## 7. Faza 4 — Primena (nedestruktivno)

### 7.1 Strategija po prioritetu
1. **CSS varijable (najčistije):** ako sajt koristi `--color-primary` itd. na `:root` ili drugim selektorima, override je samo:
   ```css
   :root { --color-primary: #e53935 !important; }
   ```
   Pazi: varijabla može biti definisana i u `@media (prefers-color-scheme: dark)` ili na `.dark` klasi — override-uj **svaki** selektor gde je definisana.
2. **Override stylesheet (glavni mehanizam):** za svako CSSOM pravilo koje ima boju, generiši pravilo sa **istim selektorom**, **istim @media omotačem**, samo sa svojstvima boja:
   ```css
   /* originalno: .btn-primary:hover { background:#1d4ed8 url(x.png) no-repeat; padding:8px } */
   @media all {
     .btn-primary:hover { background-color: #c62828 !important; }
   }
   ```
   - Za shorthand `background` koji sadrži `url()`/gradijent → upiši **ceo** `background-image` sa zamenjenim bojama, ali `url()` i pozicije netaknute.
   - `!important` je potreban jer naš sloj mora da pobedi originalnu specifičnost; pošto koristimo **isti selektor**, ne utičemo na elemente na koje original nije uticao.
   - Ako je originalna deklaracija već `!important`, i naša je; redosled (naš `<style>` je poslednji u `<head>`) rešava nerešeno.
   - Ubaci kao jedan `<style id="cc-override" data-cc>` na kraj `<head>`, ili (bolje) `document.adoptedStyleSheets = [...existing, ccSheet]` — ne dira DOM uopšte.
3. **Inline stilovi:** `element.style` ima veću prednost od stylesheet-a. Patch-uj ih kroz `el.style.setProperty(prop, newVal, priority)` i **zapamti original** u `WeakMap<Element, Record<prop,string>>` radi vraćanja. (Ovo je jedini slučaj gde diramo element — i to samo vrednost boje u već postojećem `style` atributu.)
4. **SVG atributi** (`fill="#1e3a8a"`): override preko CSS-a (`[fill="#1e3a8a" i] { fill: #c62828 !important }`) — CSS svojstvo pobeđuje prezentacioni atribut, pa ni ovde ne menjamo DOM.
5. **Computed fallback** (cross-origin CSS koji ne možemo da pročitamo): generiši pravila sa selektorom po atributu koji dodelimo (`[data-cc-id="123"]`). Ovo je jedini put kad dodajemo atribut — samo u bookmarklet režimu i samo kad nema drugog izlaza. Logovati upozorenje.

### 7.2 Dinamički sadržaj (SPA, modali, lazy load)
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

// novi <style>/<link> (CSS-in-JS: styled-components, emotion) → ponovo skeniraj samo taj sheet
```
> Zaštita od petlje: ignoriši mutacije koje sam engine proizvede (flag `isApplying`).

### 7.3 Vraćanje (`disable`)
- ukloni `ccSheet` iz `adoptedStyleSheets` / ukloni `<style data-cc>`
- vrati inline vrednosti iz `WeakMap`
- `mo.disconnect()`
- Test: posle `disable()` snimak ekrana mora biti **piksel-identičan** originalu.

### 7.4 Šta se NE menja (eksplicitno)
- slike, video, `<canvas>`, `<iframe>` drugih domena
- boje „zapečene" u SVG fajlove učitane kao `<img src="logo.svg">` (opciono kasnije: `filter: hue-rotate()` samo za ikonice koje korisnik označi)
- `transparent`, `currentColor`, `inherit` (one se same prilagode)

---

## 8. UI panel

- Renderuj u **Shadow DOM** (`attachShadow({mode:'closed'})`) na hostu `<cc-panel>` sa `all: initial` → stilovi sajta ne utiču na panel i obrnuto. Engine **isključuje** sopstveni host iz skeniranja.
- Elementi:
  1. **Detektovana paleta** — čipovi grupisani u *Dominantna / Sekundarna / Akcentna*, drag & drop za korekciju.
  2. **Tri color pickera** (`<input type="color">` + polje za HEX/OKLCH).
  3. **Preseti:** „Crveno/sivo", „Žuto/zeleno", „Zeleno/krem", „Narandžasto/tamno", „Original".
  4. **A/B prekidač** (ili taster `Alt+C`) — trenutno prebacivanje original ↔ nova paleta.
  5. **Kontrast indikator** — broj upozorenja + lista parova koji su korigovani.
  6. **Izvoz:** „Kopiraj CSS", „Preuzmi theme-override.css", „Kopiraj link" (paleta u URL hash-u: `#cc=ffffff,4a4a4a,e53935` → kolega otvori isti prikaz).
- Live preview: `apply()` je debounce-ovan (~50ms) dok se vuče picker; regeneracija mape je jeftina (samo remap tabela + ponovno generisanje teksta sheet-a, skeniranje se **ne** ponavlja).

### Primeri preseta
```ts
export const PRESETS: Record<string, Palette> = {
  'crveno-sivo':  { dominant: '#FAFAFA', secondary: '#4B4B4F', accent: '#D32F2F' },
  'zuto-zeleno':  { dominant: '#FFFDF5', secondary: '#2E5E3E', accent: '#F2B705' },
  'zeleno-krem':  { dominant: '#FBF8F1', secondary: '#3A4A3F', accent: '#2E9E5B' },
  'narandzasto-tamno': { dominant: '#121212', secondary: '#D0D0D0', accent: '#FF7A1A' },
};
```

---

## 9. CLI — trajni izvoz za produkciju

Kada se varijanta odabere, ne treba skripta u produkciji — treba **statički CSS**.

```bash
npx cc-export https://moj-sajt.rs --palette "#FAFAFA,#4B4B4F,#D32F2F" \
  --pages / /kontakt /prodavnica --out theme-override.css
```
- Playwright otvori svaku stranicu (i mobilni + desktop viewport), injektuje core, pokrene `analyze()` + `exportCss()`, spoji rezultate i ukloni duplikate.
- Alternativa za projekte sa izvornim CSS-om: **PostCSS plugin** `postcss-cc-remap` koji primenjuje istu mapu direktno na izvorne `.css`/`.scss` fajlove (generiše novu verziju fajla — original ostaje u git-u).
- Na sajt se dodaje samo: `<link rel="stylesheet" href="theme-override.css">` posle postojećih stilova.

---

## 10. Testiranje

### Unit (Vitest)
- `parse/serialize`: sve CSS sintakse boja, round-trip bez gubitka.
- `replaceColors`: `background: url(a#fff.png) #fff no-repeat` → menja samo drugu `#fff`.
- `remap`: monotonost — ako je `A` svetlija od `B` pre mapiranja, mora biti i posle.
- `contrast`: poznati parovi (crno/belo = 21:1).
- `classify`: sintetički skupovi (tipičan Bootstrap, Tailwind slate+blue, Material).

### E2E (Playwright) na `fixtures/`
| Fixture | Šta proverava |
|---|---|
| `blue-gray-vars/` | sajt sa CSS varijablama |
| `blue-gray-plain/` | hardkodovani HEX-ovi, bez varijabli |
| `tailwind/` | utility klase, `hover:` varijante |
| `bootstrap-cdn/` | cross-origin stylesheet |
| `spa-react/` | dinamički sadržaj, CSS-in-JS |
| `inline-svg/` | `fill` atributi, inline `style` |

Asercije:
1. **Struktura netaknuta:** `document.body.outerHTML` (bez našeg hosta) identičan pre i posle `apply()`.
2. **Layout netaknut:** `getBoundingClientRect()` svih elemenata identičan pre/posle.
3. **Funkcionalnost:** klik na dugmad/forme radi isto (event listeneri netaknuti).
4. **Reverzibilnost:** screenshot posle `disable()` === screenshot originala (`toHaveScreenshot` sa `maxDiffPixels: 0`).
5. **60-30-10 provera:** izmeri udeo površine po ulozi posle primene — logovati, upozoriti ako akcent > 15%.
6. **Kontrast:** axe-core `color-contrast` pravilo ne sme imati nove greške u odnosu na original.

---

## 11. Granični slučajevi (checklist)

- [ ] `@media (prefers-color-scheme: dark)` — mapiraj i dark varijantu (posebna paleta ili automatski izvedena)
- [ ] `:hover`, `:focus-visible`, `:active`, `:disabled`, `::selection`, `::placeholder`, `::marker`
- [ ] gradijenti sa više stop-ova, `color-mix()`, `rgb(from var(--x) r g b / .5)` (relativne boje)
- [ ] boje sa alfom (`rgba(30,58,138,.1)` → zadrži alfu)
- [ ] `transition: background-color` — naš override ne sme da izazove animaciju pri uključivanju (privremeno `* { transition: none !important }` tokom prvog `apply`, pa ukloni)
- [ ] `@layer` — naš sheet van slojeva pobeđuje sve slojevite stilove (dobro)
- [ ] Shadow DOM web komponente — skeniraj `shadowRoot`-ove (otvorene); zatvoreni nisu dostupni → upozorenje
- [ ] iframe istog porekla — opciono rekurzivno
- [ ] stroga CSP (`style-src` bez `'unsafe-inline'`) → koristi `adoptedStyleSheets` (nije blokiran CSP-om kao `<style>`), ili ekstenziju
- [ ] `<meta name="theme-color">` — ponudi opcionu izmenu (to je jedini meta atribut koji ima smisla menjati; default: isključeno)
- [ ] performanse: cilj < 300 ms analiza za stranicu sa 3000 elemenata, < 16 ms `apply()` posle prve analize

---

## 12. Plan rada (milestone-i)

| # | Milestone | Isporuka | Procena |
|---|---|---|---|
| M1 | Color core | `parse`, `convert` (OKLCH), `contrast`, `replaceColors` + unit testovi | 2–3 dana |
| M2 | Skener | CSSOM + inline + varijable + ponder površine; ispis detektovane palete u konzolu | 3–4 dana |
| M3 | Klasifikacija + remap | 60/30/10 heuristika, relativno mapiranje, kontrast korekcija | 3–4 dana |
| M4 | Primena | override sheet, inline patch, observer, `disable()`; e2e testovi strukture/reverzibilnosti | 3 dana |
| M5 | UI panel + bookmarklet | Shadow DOM panel, preseti, A/B, URL hash deljenje | 3 dana |
| M6 | Ekstenzija | MV3, cross-origin CSS fetch, pamćenje po domenu | 2 dana |
| M7 | CLI izvoz | Playwright export + (opciono) PostCSS plugin | 2–3 dana |

**MVP = M1–M5** (~2.5–3 nedelje za jednog developera): bookmarklet koji na tvom plavo-sivom sajtu daje tri pickera, preset „crveno/sivo" i „žuto/zeleno", A/B prekidač i izvoz CSS-a.

---

## 13. Konvencije koda

- TypeScript `strict: true`, bez `any` u javnom API-ju.
- Core ne sme da zavisi od UI-ja; UI zavisi samo od `ColorEngine` interfejsa.
- Sve funkcije u `color/` i `map/` su **čiste** (bez DOM-a) → 100% unit pokrivenost.
- Svaki DOM upis ide kroz jedan modul (`apply/`) — lako se audituje da ništa drugo ne dira sajt.
- Prefiks za sve što ubacujemo u stranicu: `cc-` / `data-cc` (lako pronalaženje i čišćenje).
- Bundle za bookmarklet/inject: cilj < 40 KB gzip.
