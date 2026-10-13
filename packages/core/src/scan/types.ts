export type UsageSource = 'cssom' | 'inline' | 'variable' | 'svg-attr' | 'html-attr';

/** A single place in the site's code where a color (or a reference to a color variable) is declared. */
export interface Usage {
  source: UsageSource;
  /** CSS property (`background-color`, `--brand`) or attribute name (`fill`, `bgcolor`). */
  property: string;
  /** The full declared value, byte-identical to the original. */
  value: string;
  /** Concrete colors found in the value, as canonical keys (`#rrggbb` / `#rrggbbaa`). */
  colors: string[];
  /** Variables the value references (`var(--primary)` → `--primary`). */
  varRefs: string[];
  /** Rule selector (for `cssom`/`variable` from a stylesheet). For nested rules — the inner one. */
  selector?: string;
  /** Outer selectors for CSS nesting, from outermost to innermost. */
  nesting?: string[];
  /** Grouping conditions, outside in: `@media (max-width: 600px)`, `@supports …`, `@layer base`. */
  conditions: string[];
  important: boolean;
  /** Stylesheet identifier (see {@link SheetReport.id}). */
  sheet?: string;
  /** Prefix of the shadow root the rule belongs to (`''` = document). */
  scope?: string;
  /** For `@keyframes`: the full rule text (keyframes can only be replaced as a whole). */
  ruleText?: string;
  /** SVG attribute inside a multicolor graphic (≥ 3 colors in the same `<svg>`) — usually a third-party logo. */
  multicolorSvg?: boolean;
  /** Element for an inline style / attribute. Not serialized. */
  element?: Element;
}

export type SheetStatus = 'ok' | 'refetched' | 'blocked';

export interface SheetReport {
  /** `href` for external sheets, otherwise `style#<n>` / `adopted#<n>` (with the shadow host prefix). */
  id: string;
  href: string | null;
  owner: 'link' | 'style' | 'import' | 'adopted';
  status: SheetStatus;
  /** Total number of rules visited, including nested ones. */
  ruleCount: number;
}

/** How much of the screen a color covers, per usage type. Units: px² (text: an "ink" approximation). */
export interface ColorWeight {
  key: string;
  bgArea: number;
  textArea: number;
  borderArea: number;
  svgArea: number;
  /** The part of the above areas belonging to interactive elements (buttons, links, CTAs). */
  interactiveArea: number;
  elementCount: number;
  /** Canvas color the site did not declare (the browser's default white background). */
  implicit?: boolean;
}

/** A text/background pair found on the page — for checking contrast after remapping. */
export interface ContrastPair {
  fg: string;
  bg: string;
  /** Text weight (same as `textArea`). */
  weight: number;
  /** Smallest font size the pair occurs at (strictest contrast requirement). */
  minFontSize: number;
  /** Whether the pair also occurs as "small" text (WCAG threshold 4.5 instead of 3). */
  hasSmallText: boolean;
}

export interface PaletteEntry {
  key: string;
  /** Total visible area (bg + text + border + svg). */
  area: number;
  /** Share of the total visible area, 0..1. */
  share: number;
  weight: ColorWeight;
  /** How many times the color appears in declarations, per source. */
  declared: Partial<Record<UsageSource, number>>;
  /** Variables whose value contains this color. */
  variables: string[];
}

export interface ScanResult {
  usages: Usage[];
  /** Elements where a text/background pair (`"fg|bg"`) was found, up to 200 per pair. Not serialized. */
  pairElements: Map<string, Element[]>;
  /** Shadow roots by prefix (`scope`). Not serialized. */
  scopes: Map<string, ShadowRoot>;
  sheets: SheetReport[];
  weights: ColorWeight[];
  pairs: ContrastPair[];
  palette: PaletteEntry[];
  stats: { elements: number; rules: number; durationMs: number };
}
