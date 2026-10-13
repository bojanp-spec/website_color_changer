import { contrastRatio, ensureContrast, requiredContrast } from '../color/contrast.js';
import type { WcagLevel } from '../color/contrast.js';
import { oklchToRgbInGamut, rgbToOklch } from '../color/convert.js';
import { parseColor } from '../color/parse.js';
import { toHex } from '../color/serialize.js';
import type { RGBA } from '../color/types.js';
import type { Classification, Palette, Role, ScanSummary } from '../analyze/types.js';
import { remap } from './remap.js';
import type { LightnessMode } from './remap.js';

export interface ContrastAdjustment {
  /** Boja pozadine (stari ključ) prema kojoj je merena. */
  against: string;
  target: number;
  /** Kontrast odmah posle remapiranja, pre korekcije. */
  before: number;
  after: number;
}

export interface ColorMapEntry {
  from: string;
  to: string;
  role: Role;
  reason: string;
  contrast?: ContrastAdjustment;
}

export interface ColorMapResult {
  /** Stari kanonski ključ → nova boja (`#rrggbb` / `#rrggbbaa`). Zaštićene boje mapiraju na sebe. */
  map: Map<string, string>;
  entries: ColorMapEntry[];
  /** Parovi tekst/pozadina koji i posle korekcije ne dostižu cilj. */
  warnings: string[];
}

export interface ColorMapOptions {
  /** Nivo WCAG kontrasta koji se održava. `false` isključuje korekciju. Podrazumevano `'AA'`. */
  enforceContrast?: WcagLevel | false;
}

function rgbaOf(color: string, what: string): RGBA {
  const p = parseColor(color);
  if (!p) throw new Error(`Nevalidna boja za ${what}: "${color}"`);
  return p.rgba;
}

/** Boja iz alternativne šeme koja deli CSS varijablu sa datom bojom. */
function altCounterpart(classification: Classification, key: string): string | null {
  const vars = classification.roles.get(key)?.variables ?? [];
  if (!vars.length) return null;
  for (const r of classification.roles.values()) {
    if (r.scheme === 'alt' && r.variables.some((v) => vars.includes(v))) return r.key;
  }
  return null;
}

const ROLE_LABEL: Record<Exclude<Role, 'protected'>, keyof Palette> = {
  dominant: 'dominant',
  secondary: 'secondary',
  accent: 'accent',
};

/**
 * Pravi tabelu „stara boja → nova boja" za izabranu paletu, a zatim ispravlja kontrast
 * teksta prema pozadinama na kojima je zatečen (ne traži više od originalnog dizajna).
 * Deterministično: ista klasifikacija i paleta → isti rezultat.
 */
export function buildColorMap(
  classification: Classification,
  palette: Palette,
  pairs: ScanSummary['pairs'] = [],
  opts: ColorMapOptions = {},
): ColorMapResult {
  const level = opts.enforceContrast === undefined ? 'AA' : opts.enforceContrast;
  const newBases = {
    dominant: rgbToOklch(rgbaOf(palette.dominant, 'dominantnu boju')),
    secondary: rgbToOklch(rgbaOf(palette.secondary, 'sekundarnu boju')),
    accent: rgbToOklch(rgbaOf(palette.accent, 'akcentnu boju')),
  };
  const oldBase = (role: keyof typeof newBases) => {
    const key = classification.bases[role];
    return key ? classification.roles.get(key)?.oklch : undefined;
  };

  // Svetao sajt + tamna paleta (ili obrnuto): glavna šema menja polaritet.
  const flip = classification.light !== newBases.dominant.l > 0.5;
  const modeFor = (role: keyof typeof newBases, scheme: 'main' | 'alt'): LightnessMode => {
    if (!flip || scheme === 'alt') return 'keep';
    // Površine/linije ostaju „odvojene" od pozadine u novom smeru; tekst i akcenat obrću odnos.
    if (role === 'dominant') return newBases.dominant.l > 0.5 ? 'darker' : 'lighter';
    return 'invert';
  };

  const entries = new Map<string, ColorMapEntry>();
  const newRgba = new Map<string, RGBA>();
  for (const r of classification.roles.values()) {
    const base = r.role === 'protected' ? undefined : oldBase(ROLE_LABEL[r.role]);
    let rgba: RGBA;
    if (r.role === 'protected' || !base) {
      // Promena polariteta: zaštićena boja uzima vrednost koju sajt sam definiše za drugu šemu
      // (npr. `--good` iz dark mode-a), da semantička boja ostane čitljiva na novoj pozadini.
      const counterpart = flip && r.scheme === 'main' ? altCounterpart(classification, r.key) : null;
      rgba = rgbaOf(counterpart ?? r.key, r.key);
      if (counterpart) {
        newRgba.set(r.key, rgba);
        entries.set(r.key, { from: r.key, to: toHex(rgba), role: r.role, reason: `${r.reason}; vrednost iz druge šeme sajta` });
        continue;
      }
    } else {
      const role = ROLE_LABEL[r.role];
      const altKey = r.scheme === 'alt' ? classification.altBases[role] : null;
      const altBase = altKey ? classification.roles.get(altKey)?.oklch : undefined;
      if (altBase) {
        // Alternativna šema ima sopstvenu bazu. Ako nova paleta ima polaritet te šeme,
        // ona se primenjuje direktno; inače se baza alternativne šeme prvo prevede.
        const newAltBase = flip ? newBases[role] : remap(altBase, base, newBases[role]);
        rgba = oklchToRgbInGamut(remap(r.oklch, altBase, newAltBase));
      } else {
        rgba = oklchToRgbInGamut(remap(r.oklch, base, newBases[role], modeFor(role, r.scheme)));
      }
    }
    newRgba.set(r.key, rgba);
    entries.set(r.key, { from: r.key, to: toHex(rgba), role: r.role, reason: r.reason });
  }

  const warnings: string[] = [];
  if (level) fixContrast(classification, pairs, level, entries, newRgba, warnings);

  const list = [...entries.values()];
  return { map: new Map(list.map((e) => [e.from, e.to])), entries: list, warnings };
}

/** Tekstualni pregled mape (CLI). `swatch` iscrtava uzorak boje. */
export function formatColorMap(result: ColorMapResult, swatch: (hex: string) => string = () => ''): string {
  const order: Role[] = ['dominant', 'secondary', 'accent', 'protected'];
  const label: Record<Role, string> = {
    dominant: 'DOMINANTNA (60%)',
    secondary: 'SEKUNDARNA (30%)',
    accent: 'AKCENTNA (10%)',
    protected: 'NE MENJA SE',
  };
  const lines: string[] = [];
  for (const role of order) {
    const rows = result.entries.filter((e) => e.role === role);
    if (!rows.length) continue;
    lines.push('', label[role]);
    for (const e of rows) {
      const fix = e.contrast ? `  ⚖ kontrast ${e.contrast.before.toFixed(2)}→${e.contrast.after.toFixed(2)} na ${e.contrast.against}` : '';
      const arrow = role === 'protected' ? '' : ` → ${swatch(e.to)}${e.to.padEnd(10)}`;
      lines.push(`  ${swatch(e.from)}${e.from.padEnd(10)}${arrow} ${e.reason}${fix}`);
    }
  }
  if (result.warnings.length) lines.push('', '⚠ Kontrast:', ...result.warnings.map((w) => `  ${w}`));
  return lines.join('\n');
}

type Check = { fg: string; bg: string; target: number; weight: number; darker: boolean };

/**
 * Ispravlja kontrast menjajući svetlinu boje TEKSTA (nikad pozadine), uz tri pravila:
 * - smer se ne obrće: tekst koji je (posle remapiranja) tamniji od pozadine ostaje tamniji;
 * - menjaju se samo boje koje su pretežno tekst (ne dominantna pozadina koja je usput i tekst na dugmetu);
 * - korekcija se prihvata samo ako ukupno smanjuje manjak kontrasta na stranici
 *   (boja može biti tekst na više pozadina, ili i tekst i pozadina).
 * Što ne može da se reši bez menjanja pojedinačnih elemenata, ostaje u upozorenjima.
 */
function fixContrast(
  classification: Classification,
  pairs: ScanSummary['pairs'],
  level: WcagLevel,
  entries: Map<string, ColorMapEntry>,
  newRgba: Map<string, RGBA>,
  warnings: string[],
) {
  const checks: Check[] = [];
  for (const p of pairs) {
    if (!entries.has(p.fg) || !entries.has(p.bg)) continue;
    const fg = rgbaOf(p.fg, p.fg);
    const bg = rgbaOf(p.bg, p.bg);
    const original = contrastRatio(fg, bg);
    // Ne tražimo više od originala (dizajnerska odluka sajta), ali ni manje od WCAG praga.
    const target = Math.min(requiredContrast(level, !p.hasSmallText), original);
    // Smer korekcije po NOVIM bojama (posle remapiranja, uključujući promenu polariteta).
    const darker = rgbToOklch(newRgba.get(p.fg)!).l < rgbToOklch(newRgba.get(p.bg)!).l;
    checks.push({ fg: p.fg, bg: p.bg, target, weight: p.weight ?? 1, darker });
  }
  const ratio = (c: Check) => contrastRatio(newRgba.get(c.fg)!, newRgba.get(c.bg)!);
  const deficit = (c: Check) => Math.max(0, c.target - ratio(c)) * c.weight;
  const totalDeficit = () => checks.reduce((n, c) => n + deficit(c), 0);
  const failing = () => checks.filter((c) => ratio(c) < c.target - 0.005);

  const adjustable = (key: string) => {
    const r = classification.roles.get(key);
    return !!r && r.role !== 'protected' && (r.usage.text >= r.usage.bg || r.usage.bg + r.usage.text === 0);
  };

  const tried = new Set<string>();
  for (let round = 0; round < 3; round++) {
    const byFg = new Map<string, Check[]>();
    for (const c of failing()) if (adjustable(c.fg) && !tried.has(`${c.fg}|${c.bg}`)) byFg.set(c.fg, [...(byFg.get(c.fg) ?? []), c]);
    if (!byFg.size) break;
    // Najpre boje sa najviše teksta u problemu.
    const order = [...byFg.entries()].sort(
      (a, b) => b[1].reduce((n, c) => n + deficit(c), 0) - a[1].reduce((n, c) => n + deficit(c), 0),
    );
    for (const [fg, list] of order) {
      const worst = list.reduce((a, b) => (deficit(a) >= deficit(b) ? a : b));
      tried.add(`${fg}|${worst.bg}`);
      const prev = newRgba.get(fg)!;
      const before = ratio(worst);
      const fix = ensureContrast(prev, newRgba.get(worst.bg)!, worst.target, { direction: worst.darker ? 'darker' : 'lighter' });
      if (!fix.reached) continue;
      const deficitBefore = totalDeficit();
      newRgba.set(fg, fix.color);
      if (totalDeficit() >= deficitBefore) {
        newRgba.set(fg, prev); // pogoršava druge parove — odustani
        continue;
      }
      const entry = entries.get(fg)!;
      entry.to = toHex(fix.color);
      entry.contrast = { against: worst.bg, target: worst.target, before, after: fix.ratio };
    }
  }

  for (const c of checks) {
    const r = ratio(c);
    if (r < c.target - 0.05) {
      warnings.push(
        `${c.fg} na ${c.bg}: kontrast ${r.toFixed(2)} < ${c.target.toFixed(2)} (${entries.get(c.fg)!.to} na ${entries.get(c.bg)!.to})`,
      );
    }
  }
}
