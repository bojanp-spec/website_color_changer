import { rgbToOklch } from '../color/convert.js';
import { parseColor } from '../color/parse.js';
import type { OKLCH } from '../color/types.js';
import type { Classification, Role, RoleAssignment, ScanSummary } from './types.js';

export interface ClassifyOptions {
  /**
   * Varijable čije se boje ne menjaju (semantičke: greška/uspeh/upozorenje, boje grafikona).
   * Podrazumevano: imena sa red/green/good/bad/success/danger/error/warn/amber/info/…, `--c1`, `--chart-*`.
   */
  protectVariables?: RegExp | null;
  /** Ručne korekcije: ključ boje → uloga. Imaju prednost nad heuristikom. */
  overrides?: Record<string, Role>;
}

export const DEFAULT_PROTECTED_VARIABLES =
  /^--(?:[\w-]*-)?(?:red|green|orange|yellow|amber|good|bad|success|danger|error|warn|warning|info|positive|negative|c\d+|chart[\w-]*)(?:-[\w-]*)?$/i;

/** Hroma iznad koje je boja „živa" (kandidat za akcenat). */
export const VIVID_CHROMA = 0.08;
/** Hroma ispod koje nijansa praktično nije vidljiva. */
export const HUE_VISIBLE_CHROMA = 0.012;
/** Hroma ispod koje bazu tretiramo kao (obojenu) neutralu. */
export const NEUTRAL_BASE_CHROMA = 0.03;
/** Maksimalna razlika nijanse da boja pripada porodici akcenta. */
const ACCENT_HUE_WINDOW = 35;
/** Obojena boja čija se nijansa razlikuje od svih baza više od ovoga je „druga" boja → ne dira se. */
const FOREIGN_HUE = 45;
/** Ispod ove alfe boja se ne remapira (praktično nevidljiva). */
const MIN_ALPHA = 0.05;

export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function oklchOf(key: string): OKLCH | null {
  const p = parseColor(key);
  return p ? rgbToOklch(p.rgba) : null;
}

/** `#rrggbbaa` → `#rrggbb` */
const opaqueKey = (key: string) => key.slice(0, 7);

type Entry = ScanSummary['palette'][number];

const TEXT_PROPS = /^(color|fill|stroke|-webkit-text-fill-color|text-decoration-color|caret-color)$/;
/** Konteksti u kojima boja nije „boja za gledanje": maske (alfa), operand u color-mix(), senke. */
const MASK_PROPS = /^(-webkit-)?mask/;
const SHADOW_PROPS = /(^|-)shadow($|-)/;

type Usage = ScanSummary['usages'][number];
const DARK_CONTEXT = { cond: /prefers-color-scheme:\s*dark/i, sel: /\[data-(?:theme|mode|bs-theme|color-scheme)=["']?dark|\.dark\b|\.theme-dark\b/i };
const LIGHT_CONTEXT = { cond: /prefers-color-scheme:\s*light/i, sel: /\[data-(?:theme|mode|bs-theme|color-scheme)=["']?light|\.light\b|\.theme-light\b/i };

/**
 * Faza 2: dodeljuje svakoj boji sajta ulogu po pravilu 60-30-10.
 *
 * 1. Dominantna = najveća površina pozadine; sekundarna = najviše teksta; akcenat = živa boja
 *    sa najviše površine na interaktivnim elementima.
 * 2. Vidljive boje: živa boja blizu nijanse akcenta → akcenat; boja „strane" nijanse → zaštićena;
 *    svetla/tamna nijansa akcenta (wash) → akcenat; tekst → sekundarna; ostalo → bliža svetlinom.
 * 3. Nevidljive boje (hover, dark mode) nasleđuju ulogu preko CSS varijable koju dele sa vidljivom bojom.
 */
export function classify(scan: ScanSummary, opts: ClassifyOptions = {}): Classification {
  const protect = opts.protectVariables === undefined ? DEFAULT_PROTECTED_VARIABLES : opts.protectVariables;
  const entries = scan.palette
    .map((e) => ({ e, o: oklchOf(e.key) }))
    .filter((x): x is { e: Entry; o: OKLCH } => x.o !== null && x.o.a >= MIN_ALPHA);
  const byKey = new Map(entries.map((x) => [x.e.key, x]));
  const opaque = entries.filter((x) => x.o.a >= 0.99);
  if (!opaque.length) throw new Error('Paleta je prazna — nema boja za klasifikaciju.');

  const argmax = <T>(list: T[], score: (x: T) => number): T | undefined =>
    list.reduce<T | undefined>((best, x) => (best === undefined || score(x) > score(best) ? x : best), undefined);

  // --- 1. Bazne boje
  const dominant = argmax(opaque, (x) => (x.e.weight.interactiveArea > x.e.area / 2 ? -1 : x.e.weight.bgArea))!;
  const rest = opaque.filter((x) => x !== dominant);
  const secondary =
    argmax(
      rest.filter((x) => x.e.weight.textArea > 0),
      (x) => x.e.weight.textArea,
    ) ?? argmax(rest, (x) => x.e.area) ?? dominant;
  const accent = argmax(
    rest.filter((x) => x !== secondary && x.o.c >= VIVID_CHROMA && x.e.weight.interactiveArea > 0),
    (x) => x.e.weight.interactiveArea,
  );

  const light = dominant.o.l > 0.5;
  const usagesOf = new Map<string, Usage[]>();
  for (const u of scan.usages) for (const c of u.colors) usagesOf.set(c, [...(usagesOf.get(c) ?? []), u]);
  const alt = light ? DARK_CONTEXT : LIGHT_CONTEXT;
  const isAltSchemeOnly = (key: string) => {
    const list = usagesOf.get(key) ?? [];
    return list.length > 0 && list.every((u) => (u.conditions ?? []).some((c) => alt.cond.test(c)) || alt.sel.test(u.selector ?? ''));
  };
  /** Boja koja se javlja samo kao maska, operand u color-mix() ili (neutralna) senka. */
  const nonPaintOnly = (key: string, o: OKLCH) => {
    const list = usagesOf.get(key) ?? [];
    return (
      list.length > 0 &&
      list.every(
        (u) =>
          MASK_PROPS.test(u.property) ||
          (u.value ?? '').includes('color-mix(') ||
          (o.c < 0.01 && SHADOW_PROPS.test(u.property)),
      )
    );
  };

  const roles = new Map<string, RoleAssignment>();
  const assign = (key: string, role: Role, reason: string) => {
    const x = byKey.get(key);
    if (x && !roles.has(key)) {
      const w = x.e.weight;
      roles.set(key, {
        key,
        role,
        oklch: x.o,
        reason,
        usage: { bg: w.bgArea, text: w.textArea, border: w.borderArea + w.svgArea },
        scheme: x.e.area === 0 && isAltSchemeOnly(key) ? 'alt' : 'main',
        variables: x.e.variables,
      });
    }
  };

  for (const [key, role] of Object.entries(opts.overrides ?? {})) assign(key, role, 'ručno podešeno');
  assign(dominant.e.key, 'dominant', 'najveća površina pozadine');
  assign(secondary.e.key, 'secondary', 'najviše teksta');
  if (accent) assign(accent.e.key, 'accent', 'živa boja na interaktivnim elementima');

  const baseHues = [secondary, accent, dominant].filter((b) => b && b.o.c >= NEUTRAL_BASE_CHROMA).map((b) => b!.o.h);
  const isProtectedByName = (e: Entry) => !!protect && e.variables.length > 0 && e.variables.every((v) => protect.test(v));
  const isText = (e: Entry) =>
    e.area > 0
      ? e.weight.textArea >= e.weight.bgArea + e.weight.borderArea + e.weight.svgArea
      : scan.usages.some((u) => u.colors.includes(e.key) && TEXT_PROPS.test(u.property));
  const byLightness = (o: OKLCH): Role =>
    Math.abs(o.l - dominant.o.l) <= Math.abs(o.l - secondary.o.l) ? 'dominant' : 'secondary';

  const heuristic = (x: { e: Entry; o: OKLCH }, visible: boolean): [Role, string] | null => {
    const { e, o } = x;
    if (e.area === 0 && nonPaintOnly(e.key, o)) return ['protected', 'samo maska / color-mix() / senka'];
    if (isProtectedByName(e)) return ['protected', `zaštićena varijabla (${e.variables.join(', ')})`];
    if (accent && o.c >= VIVID_CHROMA && hueDistance(o.h, accent.o.h) <= ACCENT_HUE_WINDOW) {
      // Akcenat je MALA površina (10%). Velika neinteraktivna površina iste nijanse
      // (npr. tamnoplavi header uz plavo CTA dugme) je struktura sajta, ne akcenat.
      const structural = visible && e.area > 2 * accent.e.area && e.weight.interactiveArea < e.area / 2;
      if (!structural) return ['accent', 'živa boja u nijansi akcenta'];
      if (isText(e)) return ['secondary', 'tekst u nijansi akcenta (velika površina)'];
      return [byLightness(o), 'velika površina u nijansi akcenta → struktura'];
    }
    if (o.c >= NEUTRAL_BASE_CHROMA && baseHues.length && baseHues.every((h) => hueDistance(o.h, h) > FOREIGN_HUE)) {
      return ['protected', 'nijansa van palete sajta (semantička/ostala boja)'];
    }
    if (o.c >= VIVID_CHROMA) return ['protected', 'živa boja van akcenta'];
    if (accent && o.c >= HUE_VISIBLE_CHROMA) {
      const toAccent = hueDistance(o.h, accent.o.h);
      const toDominant = dominant.o.c >= HUE_VISIBLE_CHROMA / 2 ? hueDistance(o.h, dominant.o.h) : 180;
      const toSecondary = hueDistance(o.h, secondary.o.h);
      if (toAccent <= 10 && toAccent + 10 < Math.min(toDominant, toSecondary)) return ['accent', 'svetla/tamna nijansa akcenta'];
    }
    if (!visible) return null; // nevidljive bez jasnog signala → nasleđivanje preko varijabli
    if (isText(e)) return ['secondary', 'tekst'];
    const role = byLightness(o);
    return [role, role === 'dominant' ? 'pozadina/struktura bliska dominantnoj' : 'tamna/struktura bliska sekundarnoj'];
  };

  // --- 2. Vidljive boje
  const pending: { e: Entry; o: OKLCH }[] = [];
  for (const x of entries) {
    if (roles.has(x.e.key)) continue;
    if (x.o.a < 0.99) continue; // providne varijante — posle, po opaknoj verziji
    if (x.e.area > 0) {
      const r = heuristic(x, true);
      if (r) assign(x.e.key, ...r);
    } else {
      pending.push(x);
    }
  }

  // --- 3. Nevidljive boje: preko varijabli, pa heuristika, pa svetlina/upotreba
  const varRole = new Map<string, RoleAssignment>();
  for (const x of [...entries].sort((a, b) => b.e.area - a.e.area)) {
    const r = roles.get(x.e.key);
    if (!r || x.e.area === 0) continue;
    for (const v of x.e.variables) if (!varRole.has(v)) varRole.set(v, r);
  }
  for (const x of pending) {
    const h = heuristic(x, false);
    if (h && (h[0] === 'protected' || h[0] === 'accent')) {
      assign(x.e.key, ...h);
      continue;
    }
    const inherited = x.e.variables.map((v) => [v, varRole.get(v)] as const).find(([, r]) => r);
    if (inherited) {
      assign(x.e.key, inherited[1]!.role, `nasleđeno preko ${inherited[0]} (npr. dark mode/hover)`);
      continue;
    }
    if (isText(x.e)) assign(x.e.key, 'secondary', 'tekst (deklarisano)');
    else assign(x.e.key, byLightness(x.o), 'po svetlini (deklarisano)');
  }

  // --- 4. Providne varijante (`#10233f40` senke itd.) prate opaknu boju
  for (const x of entries) {
    if (roles.has(x.e.key)) continue;
    if (x.e.area === 0 && nonPaintOnly(x.e.key, x.o)) {
      assign(x.e.key, 'protected', 'samo maska / color-mix() / senka');
      continue;
    }
    const base = roles.get(opaqueKey(x.e.key));
    if (base) {
      assign(x.e.key, base.role, `providna varijanta ${opaqueKey(x.e.key)}`);
      continue;
    }
    const h = heuristic(x, x.e.area > 0);
    if (h) assign(x.e.key, ...h);
    else assign(x.e.key, byLightness(x.o), 'providna, po svetlini');
  }

  const altBaseFor = (baseKey: string | undefined): string | null => {
    if (!baseKey) return null;
    const vars = byKey.get(baseKey)?.e.variables ?? [];
    for (const v of vars) {
      const alt = entries.find((x) => x.e.variables.includes(v) && roles.get(x.e.key)?.scheme === 'alt' && x.o.a >= 0.99);
      if (alt) return alt.e.key;
    }
    return null;
  };

  return {
    light,
    altBases: {
      dominant: altBaseFor(dominant.e.key),
      secondary: altBaseFor(secondary.e.key),
      accent: altBaseFor(accent?.e.key),
    },
    bases: { dominant: dominant.e.key, secondary: secondary.e.key, accent: accent?.e.key ?? null },
    roles,
  };
}
