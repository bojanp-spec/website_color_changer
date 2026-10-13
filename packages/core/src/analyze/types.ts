import type { OKLCH } from '../color/types.js';

/** Roles per the 60-30-10 rule. `protected` = color is not changed (semantic colors, charts, unknown). */
export type Role = 'dominant' | 'secondary' | 'accent' | 'protected';

/** The three palette colors (60 / 30 / 10). */
export type PaletteColor = 'dominant' | 'secondary' | 'accent';

/** The three colors the user picks (any CSS color notation). */
export interface Palette {
  dominant: string;
  secondary: string;
  accent: string;
  /** Brightness of the new colors, -100…100 (0 = unchanged). */
  brightness?: number;
  /** Contrast (lightness spread) of the new colors, -100…100 (0 = unchanged). */
  contrast?: number;
}

export interface RoleAssignment {
  key: string;
  role: Role;
  oklch: OKLCH;
  /** Short explanation of why the color got its role (Serbian) — shown in the CLI. */
  reason: string;
  /** Reason code — the UI translates it (`reasonText(code, arg, 'en')`). */
  reasonCode: import('./reasons.js').ReasonCode;
  reasonArg?: string;
  /** Measured visible area per usage type (0 for colors not currently visible). */
  usage: { bg: number; text: number; border: number };
  /**
   * `alt` = the color exists only in the site's alternate scheme (e.g. dark mode on a light site).
   * When polarity flips (light → dark palette), only `main` colors invert their lightness relations.
   */
  scheme: 'main' | 'alt';
  /** CSS variables that carry this color. */
  variables: string[];
}

export interface Classification {
  /** Whether the site's main scheme is light (dominant color L > 0.5). */
  light: boolean;
  /** Base colors of the roles (canonical keys). `accent` is `null` if the site has no distinct accent color. */
  bases: { dominant: string; secondary: string; accent: string | null };
  /**
   * Base colors of the alternate scheme (e.g. dark mode of a light site): the color from that scheme
   * that shares a CSS variable with the base color (`--paper` in dark mode). `null` if there is none.
   */
  altBases: { dominant: string | null; secondary: string | null; accent: string | null };
  roles: Map<string, RoleAssignment>;
}

/** Minimal subset of scan results used by classification — serializable (JSON). */
export interface ScanSummary {
  palette: {
    key: string;
    area: number;
    weight: { bgArea: number; textArea: number; borderArea: number; svgArea: number; interactiveArea: number };
    variables: string[];
  }[];
  usages: {
    source: string;
    property: string;
    value?: string;
    colors: string[];
    selector?: string;
    conditions?: string[];
    multicolorSvg?: boolean;
  }[];
  pairs: { fg: string; bg: string; minFontSize: number; hasSmallText: boolean; weight?: number }[];
}
