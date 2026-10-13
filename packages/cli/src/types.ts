import type { ContrastPair, LocalContrastFix, PaletteEntry, SheetReport, Usage } from '@cc/core';

/** A color usage without a DOM element reference (serializable from the browser). */
export type PlainUsage = Omit<Usage, 'element'> & { inline?: boolean };

/** Scan result for one page in one viewport. */
export interface PageScan {
  url: string;
  viewport: number;
  usages: PlainUsage[];
  palette: PaletteEntry[];
  pairs: ContrastPair[];
  sheets: SheetReport[];
  /** Same-domain links (for --crawl). */
  links: string[];
}

export interface PageVerification {
  url: string;
  viewport: number;
  /** Texts whose contrast dropped below min(AA, original) after applying the CSS. */
  contrastRegressions: { text: string; before: number; after: number }[];
  /** Elements still showing an old color that should have changed (e.g. inline style). */
  uncovered: { selector: string; property: string; color: string }[];
  screenshot?: string;
}

export interface ExportReport {
  palette: { dominant: string; secondary: string; accent: string };
  pages: { url: string; viewport: number; colors: number; blockedSheets: string[] }[];
  bases: { dominant: string; secondary: string; accent: string | null };
  rules: number;
  localFixes: LocalContrastFix[];
  warnings: string[];
  verification: PageVerification[];
}
