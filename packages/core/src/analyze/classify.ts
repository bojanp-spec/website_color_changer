import { rgbToOklch } from '../color/convert.js';
import { parseColor } from '../color/parse.js';
import type { OKLCH } from '../color/types.js';
import { coreText } from '../i18n.js';
import type { Lang } from '../i18n.js';
import { reasonText } from './reasons.js';
import type { ReasonCode } from './reasons.js';
import type { Classification, Role, RoleAssignment, ScanSummary } from './types.js';

export interface ClassifyOptions {
  /**
   * Variables whose colors are never changed (semantic: error/success/warning, chart colors).
   * Default: names containing red/green/good/bad/success/danger/error/warn/amber/info/…, `--c1`, `--chart-*`.
   */
  protectVariables?: RegExp | null;
  /** Manual overrides: color key → role. They take precedence over the heuristic. */
  overrides?: Record<string, Role>;
  /** Language of error messages. Default `'sr'`. */
  lang?: Lang;
}

export const DEFAULT_PROTECTED_VARIABLES =
  /^--(?:[\w-]*-)?(?:red|green|orange|yellow|amber|good|bad|success|danger|error|warn|warning|info|positive|negative|c\d+|chart[\w-]*)(?:-[\w-]*)?$/i;

/** Chroma above which a color is "vivid" (an accent candidate). */
export const VIVID_CHROMA = 0.08;
/** Chroma below which the hue is practically invisible. */
export const HUE_VISIBLE_CHROMA = 0.012;
/** Chroma below which a base is treated as a (tinted) neutral. */
export const NEUTRAL_BASE_CHROMA = 0.03;
/** Maximum hue difference for a color to belong to the accent family. */
const ACCENT_HUE_WINDOW = 35;
/** A chromatic color whose hue differs from all bases by more than this is a "different" color → left alone. */
const FOREIGN_HUE = 45;
/** Colors below this alpha are not remapped (practically invisible). */
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
/** Contexts where a color is not "seen" as paint: masks (alpha), color-mix() operands, shadows. */
const MASK_PROPS = /^(-webkit-)?mask/;
const SHADOW_PROPS = /(^|-)shadow($|-)/;

type Usage = ScanSummary['usages'][number];

/** Whether the declaration is in an alternate-scheme context (dark mode on a light site and vice versa). */
export function isAltContext(u: Pick<Usage, 'selector' | 'conditions'>, siteIsLight: boolean): boolean {
  const alt = siteIsLight ? DARK_CONTEXT : LIGHT_CONTEXT;
  return (u.conditions ?? []).some((c) => alt.cond.test(c)) || alt.sel.test(u.selector ?? '');
}

const DARK_CONTEXT = { cond: /prefers-color-scheme:\s*dark/i, sel: /\[data-(?:theme|mode|bs-theme|color-scheme)=["']?dark|\.dark\b|\.theme-dark\b/i };
const LIGHT_CONTEXT = { cond: /prefers-color-scheme:\s*light/i, sel: /\[data-(?:theme|mode|bs-theme|color-scheme)=["']?light|\.light\b|\.theme-light\b/i };

/**
 * Phase 2: assigns every site color a role according to the 60-30-10 rule.
 *
 * 1. Dominant = largest background area; secondary = most text; accent = the vivid color
 *    with the most area on interactive elements.
 * 2. Visible colors: vivid color near the accent hue → accent; color of a "foreign" hue → protected;
 *    light/dark tint of the accent (wash) → accent; text → secondary; rest → whichever is closer in lightness.
 * 3. Invisible colors (hover, dark mode) inherit their role via a CSS variable shared with a visible color.
 */
export function classify(scan: ScanSummary, opts: ClassifyOptions = {}): Classification {
  const protect = opts.protectVariables === undefined ? DEFAULT_PROTECTED_VARIABLES : opts.protectVariables;
  const entries = scan.palette
    .map((e) => ({ e, o: oklchOf(e.key) }))
    .filter((x): x is { e: Entry; o: OKLCH } => x.o !== null && x.o.a >= MIN_ALPHA);
  const byKey = new Map(entries.map((x) => [x.e.key, x]));
  const opaque = entries.filter((x) => x.o.a >= 0.99);
  if (!opaque.length) throw new Error(coreText(opts.lang).emptyPalette);

  const argmax = <T>(list: T[], score: (x: T) => number): T | undefined =>
    list.reduce<T | undefined>((best, x) => (best === undefined || score(x) > score(best) ? x : best), undefined);

  // --- 1. Base colors
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
  const isAltSchemeOnly = (key: string) => {
    const list = usagesOf.get(key) ?? [];
    return list.length > 0 && list.every((u) => isAltContext(u, light));
  };
  /** A color that appears only as a mask, a color-mix() operand or a (neutral) shadow. */
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

  /** The color appears only in multicolor SVG graphics (e.g. a Google/Apple logo on a sign-in button). */
  const inMulticolorGraphicOnly = (key: string) => {
    const list = usagesOf.get(key) ?? [];
    return list.length > 0 && list.every((u) => u.multicolorSvg);
  };

  const roles = new Map<string, RoleAssignment>();
  const assign = (key: string, role: Role, code: ReasonCode, arg?: string) => {
    const x = byKey.get(key);
    if (x && !roles.has(key)) {
      const w = x.e.weight;
      roles.set(key, {
        key,
        role,
        oklch: x.o,
        reason: reasonText(code, arg),
        reasonCode: code,
        ...(arg !== undefined ? { reasonArg: arg } : {}),
        usage: { bg: w.bgArea, text: w.textArea, border: w.borderArea + w.svgArea },
        scheme: x.e.area === 0 && isAltSchemeOnly(key) ? 'alt' : 'main',
        variables: x.e.variables,
      });
    }
  };

  for (const [key, role] of Object.entries(opts.overrides ?? {})) assign(key, role, 'manual');
  assign(dominant.e.key, 'dominant', 'largest-background');
  assign(secondary.e.key, 'secondary', 'most-text');
  if (accent) assign(accent.e.key, 'accent', 'vivid-interactive');

  const baseHues = [secondary, accent, dominant].filter((b) => b && b.o.c >= NEUTRAL_BASE_CHROMA).map((b) => b!.o.h);
  const isProtectedByName = (e: Entry) => !!protect && e.variables.length > 0 && e.variables.every((v) => protect.test(v));
  const isText = (e: Entry) =>
    e.area > 0
      ? e.weight.textArea >= e.weight.bgArea + e.weight.borderArea + e.weight.svgArea
      : scan.usages.some((u) => u.colors.includes(e.key) && TEXT_PROPS.test(u.property));
  const byLightness = (o: OKLCH): Role =>
    Math.abs(o.l - dominant.o.l) <= Math.abs(o.l - secondary.o.l) ? 'dominant' : 'secondary';

  const heuristic = (x: { e: Entry; o: OKLCH }, visible: boolean): [Role, ReasonCode, string?] | null => {
    const { e, o } = x;
    if (e.area === 0 && nonPaintOnly(e.key, o)) return ['protected', 'non-paint'];
    if (inMulticolorGraphicOnly(e.key)) return ['protected', 'multicolor-svg'];
    if (isProtectedByName(e)) return ['protected', 'protected-variable', e.variables.join(', ')];
    if (accent && o.c >= VIVID_CHROMA && hueDistance(o.h, accent.o.h) <= ACCENT_HUE_WINDOW) {
      // The accent is a SMALL area (10%). A large non-interactive area of the same hue
      // (e.g. a dark blue header next to a blue CTA button) is site structure, not accent.
      const structural = visible && e.area > 2 * accent.e.area && e.weight.interactiveArea < e.area / 2;
      if (!structural) return ['accent', 'vivid-accent-hue'];
      if (isText(e)) return ['secondary', 'accent-hue-large-text'];
      return [byLightness(o), 'accent-hue-structure'];
    }
    if (o.c >= NEUTRAL_BASE_CHROMA && baseHues.length && baseHues.every((h) => hueDistance(o.h, h) > FOREIGN_HUE)) {
      return ['protected', 'foreign-hue'];
    }
    if (o.c >= VIVID_CHROMA) return ['protected', 'vivid-other'];
    if (accent && o.c >= HUE_VISIBLE_CHROMA) {
      const toAccent = hueDistance(o.h, accent.o.h);
      const toDominant = dominant.o.c >= HUE_VISIBLE_CHROMA / 2 ? hueDistance(o.h, dominant.o.h) : 180;
      const toSecondary = hueDistance(o.h, secondary.o.h);
      if (toAccent <= 10 && toAccent + 10 < Math.min(toDominant, toSecondary)) return ['accent', 'accent-tint'];
    }
    if (!visible) return null; // invisible with no clear signal → inherit via variables
    if (isText(e)) return ['secondary', 'text'];
    const role = byLightness(o);
    return [role, role === 'dominant' ? 'near-dominant' : 'near-secondary'];
  };

  // --- 2. Visible colors
  const pending: { e: Entry; o: OKLCH }[] = [];
  for (const x of entries) {
    if (roles.has(x.e.key)) continue;
    if (x.o.a < 0.99) continue; // translucent variants — later, via the opaque version
    if (x.e.area > 0) {
      const r = heuristic(x, true);
      if (r) assign(x.e.key, ...r);
    } else {
      pending.push(x);
    }
  }

  // --- 3. Invisible colors: via variables, then heuristic, then lightness/usage
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
      assign(x.e.key, inherited[1]!.role, 'inherited-variable', inherited[0]);
      continue;
    }
    if (isText(x.e)) assign(x.e.key, 'secondary', 'declared-text');
    else assign(x.e.key, byLightness(x.o), 'declared-lightness');
  }

  // --- 4. Translucent variants (`#10233f40` shadows etc.) follow the opaque color
  for (const x of entries) {
    if (roles.has(x.e.key)) continue;
    if (x.e.area === 0 && nonPaintOnly(x.e.key, x.o)) {
      assign(x.e.key, 'protected', 'non-paint');
      continue;
    }
    const base = roles.get(opaqueKey(x.e.key));
    if (base) {
      assign(x.e.key, base.role, 'translucent-variant', opaqueKey(x.e.key));
      continue;
    }
    const h = heuristic(x, x.e.area > 0);
    if (h) assign(x.e.key, ...h);
    else assign(x.e.key, byLightness(x.o), 'translucent-lightness');
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
