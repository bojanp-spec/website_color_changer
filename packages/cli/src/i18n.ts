import { PRESET_LABELS_EN, PRESETS } from '@cc/core';

export type Lang = 'sr' | 'en';

/**
 * Output language: `--lang en|sr`, then the `CC_LANG` variable, then the system language (`LC_ALL`/`LANG`):
 * `sr*` → Serbian, anything else → English.
 */
export function detectLang(argv: string[], env: NodeJS.ProcessEnv = process.env): Lang {
  const i = argv.findIndex((a) => a === '--lang' || a.startsWith('--lang='));
  const flag = i === -1 ? undefined : argv[i]!.includes('=') ? argv[i]!.split('=')[1] : argv[i + 1];
  const value = (flag || env.CC_LANG || env.LC_ALL || env.LANG || '').toLowerCase();
  return value.startsWith('sr') ? 'sr' : 'en';
}

const presetList = (lang: Lang) =>
  Object.keys(PRESETS)
    .map((id) => (lang === 'en' ? `${id} (${PRESET_LABELS_EN[id]})` : id))
    .join(lang === 'en' ? '\n  ' : ', ');

const MESSAGES = {
  sr: {
    help: () => `cc-export — izvoz palete za produkciju (jedan CSS fajl za ceo sajt)

Upotreba:
  cc-export <url> --palette <preset | "#dom,#sek,#akc"> [opcije]

Opcije:
  --pages /,/kontakt,/cenovnik   dodatne stranice (putanje u odnosu na <url>)
  --crawl <N>                    obiđi do N stranica prateći linkove sa iste domene
  --viewports 1440,390           širine prikaza (podrazumevano desktop i mobilni)
  --out theme-override.css       izlazni CSS (podrazumevano theme-override.css)
  --map paleta.map.json          mapa stara → nova boja (za PostCSS plugin)
  --report izvestaj.json         detaljan izveštaj (klasifikacija, korekcije, provera)
  --screenshots <dir>            snimci stranica sa primenjenim CSS-om
  --override "#e7f2fa=dominant"  ručna uloga boje (može više puta)
  --all-colors                   menjaj i semantičke boje / boje grafikona
  --no-verify                    preskoči proveru CSS-a na stranicama
  --no-scroll                    ne skroluj stranice pre skeniranja
  --wait <ms>                    dodatno čekanje posle učitavanja
  --lang sr|en                   jezik poruka (podrazumevano: jezik sistema)

Preseti: ${presetList('sr')}`,
    needsValue: (name: string) => `--${name} traži vrednost`,
    badColor: (p: string) => `Nevalidna boja u --palette: "${p}"`,
    paletteCount: '--palette traži preset ili tačno tri boje: "#dom,#sek,#akc"',
    badOverride: (item: string) => `--override "${item}": očekuje se "#boja=dominant|secondary|accent|protected"`,
    scanned: (url: string, vp: number, n: number) => `  skenirano ${url} @${vp}px — ${n} boja`,
    classified: (d: string, s: string, a: string) => `  klasifikacija: ${d} / ${s} / ${a}`,
    verified: (url: string, vp: number, regressions: number, uncovered: number) =>
      `  provera ${url} @${vp}px — kontrast: ${regressions ? `⚠ ${regressions}` : 'OK'}, nepokriveno: ${uncovered}`,
    wroteCss: (out: string, rules: number, pages: number) => `✔ ${out}: ${rules} pravila za ${pages} stranica`,
    localFixes: (n: number) => `  ⚖ lokalnih korekcija kontrasta: ${n}`,
    verifyBad: (n: number) => `  ⚠ provera: ${n} tekstova sa lošijim kontrastom (detalji u --report)`,
    verifyOk: '  ✔ provera: kontrast svih tekstova OK',
    uncovered: (n: number) => `  ⚠ provera: ${n} elemenata zadržava staru boju (inline stilovi?) — detalji u --report`,
    noSelector: (fg: string, bg: string, to: string, n: number) =>
      `Lokalni kontrast ${fg} na ${bg} → ${to}: nema bezbednog selektora (${n} elemenata) — dodati ručno.`,
    shadow: (list: string) => `Stilovi u shadow DOM-u (${list}) nisu u CSS fajlu — web komponente ih ne nasleđuju.`,
    inline: (n: number) => `${n} boja je u inline style/SVG atributima — CSS fajl ih ne pokriva (vidi „uncovered" u izveštaju).`,
    contrast: (fg: string, bg: string, ratio: string, target: string, toFg: string, toBg: string) =>
      `${fg} na ${bg}: kontrast ${ratio} < ${target} (${toFg} na ${toBg})`,
    cssPalette: 'Paleta:',
    cssSite: 'Sajt:  ',
    cssPages: (n: number) => `Stranice (${n}):`,
    cssAfter: 'Uključiti POSLE svih postojećih stilova sajta.',
    cssLocal: 'Lokalna korekcija kontrasta (npr. tekst na CTA dugmadi)',
  },
  en: {
    help: () => `cc-export — palette export for production (one CSS file for the whole site)

Usage:
  cc-export <url> --palette <preset | "#dom,#sec,#acc"> [options]

Options:
  --pages /,/contact,/pricing    extra pages (paths relative to <url>)
  --crawl <N>                    visit up to N pages by following same-domain links
  --viewports 1440,390           viewport widths (default: desktop and mobile)
  --out theme-override.css       output CSS (default: theme-override.css)
  --map palette.map.json         old → new color map (for the PostCSS plugin)
  --report report.json           detailed report (classification, fixes, verification)
  --screenshots <dir>            screenshots of the pages with the CSS applied
  --override "#e7f2fa=dominant"  set a color's role manually (repeatable)
  --all-colors                   also change semantic and chart colors
  --no-verify                    skip verifying the CSS on the pages
  --no-scroll                    don't scroll pages before scanning
  --wait <ms>                    extra wait after the page loads
  --lang en|sr                   message language (default: system language)

Presets:
  ${presetList('en')}`,
    needsValue: (name: string) => `--${name} needs a value`,
    badColor: (p: string) => `Invalid color in --palette: "${p}"`,
    paletteCount: '--palette needs a preset or exactly three colors: "#dom,#sec,#acc"',
    badOverride: (item: string) => `--override "${item}": expected "#color=dominant|secondary|accent|protected"`,
    scanned: (url: string, vp: number, n: number) => `  scanned ${url} @${vp}px — ${n} colors`,
    classified: (d: string, s: string, a: string) => `  classification: ${d} / ${s} / ${a}`,
    verified: (url: string, vp: number, regressions: number, uncovered: number) =>
      `  verified ${url} @${vp}px — contrast: ${regressions ? `⚠ ${regressions}` : 'OK'}, uncovered: ${uncovered}`,
    wroteCss: (out: string, rules: number, pages: number) => `✔ ${out}: ${rules} rules for ${pages} pages`,
    localFixes: (n: number) => `  ⚖ local contrast fixes: ${n}`,
    verifyBad: (n: number) => `  ⚠ verification: ${n} texts lost contrast (details in --report)`,
    verifyOk: '  ✔ verification: contrast of all texts OK',
    uncovered: (n: number) => `  ⚠ verification: ${n} elements kept an old color (inline styles?) — details in --report`,
    noSelector: (fg: string, bg: string, to: string, n: number) =>
      `Local contrast ${fg} on ${bg} → ${to}: no safe selector (${n} elements) — add it manually.`,
    shadow: (list: string) => `Styles in shadow DOM (${list}) are not in the CSS file — web components don't inherit them.`,
    inline: (n: number) => `${n} colors are in inline style/SVG attributes — the CSS file doesn't cover them (see "uncovered" in the report).`,
    contrast: (fg: string, bg: string, ratio: string, target: string, toFg: string, toBg: string) =>
      `${fg} on ${bg}: contrast ${ratio} < ${target} (${toFg} on ${toBg})`,
    cssPalette: 'Palette:',
    cssSite: 'Site:   ',
    cssPages: (n: number) => `Pages (${n}):`,
    cssAfter: "Include AFTER all of the site's existing styles.",
    cssLocal: 'Local contrast fix (e.g. text on CTA buttons)',
  },
} as const;

export type Messages = (typeof MESSAGES)['en'];
export const messages = (lang: Lang): Messages => MESSAGES[lang] as unknown as Messages;
