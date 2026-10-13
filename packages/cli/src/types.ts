import type { ContrastPair, LocalContrastFix, PaletteEntry, SheetReport, Usage } from '@cc/core';

/** Upotreba boje bez reference na DOM element (serijalizabilna iz browsera). */
export type PlainUsage = Omit<Usage, 'element'> & { inline?: boolean };

/** Rezultat skeniranja jedne stranice u jednom prikazu. */
export interface PageScan {
  url: string;
  viewport: number;
  usages: PlainUsage[];
  palette: PaletteEntry[];
  pairs: ContrastPair[];
  sheets: SheetReport[];
  /** Linkovi sa iste domene (za --crawl). */
  links: string[];
}

export interface PageVerification {
  url: string;
  viewport: number;
  /** Tekstovi čiji je kontrast posle primene CSS-a pao ispod min(AA, original). */
  contrastRegressions: { text: string; before: number; after: number }[];
  /** Elementi koji i dalje imaju staru boju koja je trebalo da se promeni (npr. inline stil). */
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
