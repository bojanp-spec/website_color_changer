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
  /** Background color (old key) it was measured against. */
  against: string;
  target: number;
  /** Contrast right after remapping, before the fix. */
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
  /** Old canonical key → new color (`#rrggbb` / `#rrggbbaa`). Protected colors map to themselves. */
  map: Map<string, string>;
  entries: ColorMapEntry[];
  /** Text/background pairs that still miss the target after the fix. */
  warnings: string[];
  /** Same as `warnings`, structured — for local fixes on elements (M4). */
  failures: ContrastFailure[];
}

export interface ContrastFailure {
  fg: string;
  bg: string;
  target: number;
}

export interface ColorMapOptions {
  /** WCAG contrast level to maintain. `false` disables the fix. Default `'AA'`. */
  enforceContrast?: WcagLevel | false;
}

function rgbaOf(color: string, what: string): RGBA {
  const p = parseColor(color);
  if (!p) throw new Error(`Nevalidna boja za ${what}: "${color}"`);
  return p.rgba;
}

/** The color from the alternate scheme that shares a CSS variable with the given color. */
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
 * Builds an "old color → new color" table for the chosen palette, then fixes the contrast
 * of text against the backgrounds it was found on (never demanding more than the original design).
 * Deterministic: same classification and palette → same result.
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

  // Light site + dark palette (or vice versa): the main scheme flips polarity.
  const flip = classification.light !== newBases.dominant.l > 0.5;
  const modeFor = (role: keyof typeof newBases, scheme: 'main' | 'alt'): LightnessMode => {
    if (!flip || scheme === 'alt') return 'keep';
    // Surfaces/lines stay "separated" from the background in the new direction; text and accent invert the relation.
    if (role === 'dominant') return newBases.dominant.l > 0.5 ? 'darker' : 'lighter';
    return 'invert';
  };

  const entries = new Map<string, ColorMapEntry>();
  const newRgba = new Map<string, RGBA>();
  for (const r of classification.roles.values()) {
    const base = r.role === 'protected' ? undefined : oldBase(ROLE_LABEL[r.role]);
    let rgba: RGBA;
    if (r.role === 'protected' || !base) {
      // Polarity flip: a protected color takes the value the site itself defines for the other scheme
      // (e.g. `--good` from dark mode), so the semantic color stays readable on the new background.
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
        // The alternate scheme has its own base. If the new palette has that scheme's polarity,
        // it is applied directly; otherwise the alternate scheme's base is translated first.
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
  const failures: ContrastFailure[] = [];
  if (level) fixContrast(classification, pairs, level, entries, newRgba, warnings, failures);

  const list = [...entries.values()];
  return { map: new Map(list.map((e) => [e.from, e.to])), entries: list, warnings, failures };
}

/** Text overview of the map (CLI). `swatch` renders a color sample. */
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
 * Fixes contrast by changing the lightness of the TEXT color (never the background), with three rules:
 * - the direction never flips: text that is (after remapping) darker than the background stays darker;
 * - only colors that are mostly text are changed (not the dominant background that also happens to be button text);
 * - a fix is accepted only if it reduces the page's total contrast deficit
 *   (a color may be text on several backgrounds, or both text and background).
 * Whatever cannot be solved without changing individual elements stays in the warnings.
 */
function fixContrast(
  classification: Classification,
  pairs: ScanSummary['pairs'],
  level: WcagLevel,
  entries: Map<string, ColorMapEntry>,
  newRgba: Map<string, RGBA>,
  warnings: string[],
  failures: ContrastFailure[],
) {
  const checks: Check[] = [];
  for (const p of pairs) {
    if (!entries.has(p.fg) || !entries.has(p.bg)) continue;
    const fg = rgbaOf(p.fg, p.fg);
    const bg = rgbaOf(p.bg, p.bg);
    const original = contrastRatio(fg, bg);
    // Don't demand more than the original (the site's design decision), but no less than the WCAG threshold.
    const target = Math.min(requiredContrast(level, !p.hasSmallText), original);
    // Fix direction based on the NEW colors (after remapping, including polarity flip).
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
    // Colors with the most failing text first.
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
        newRgba.set(fg, prev); // makes other pairs worse — give up
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
      failures.push({ fg: c.fg, bg: c.bg, target: c.target });
      warnings.push(
        `${c.fg} na ${c.bg}: kontrast ${r.toFixed(2)} < ${c.target.toFixed(2)} (${entries.get(c.fg)!.to} na ${entries.get(c.bg)!.to})`,
      );
    }
  }
}
