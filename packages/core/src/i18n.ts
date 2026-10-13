import type { Role } from './analyze/types.js';

/** Language of the texts core produces itself (reports, contrast warnings, errors). */
export type Lang = 'sr' | 'en';

export const CORE_TEXT = {
  sr: {
    emptyPalette: 'Paleta je prazna — nema boja za klasifikaciju.',
    analyzeFirst: 'Pozovi analyze() pre apply().',
    nothingToExport: 'Nema primenjene palete za izvoz.',
    badColor: (what: string, color: string) => `Nevalidna boja za ${what}: "${color}"`,
    paletteColor: { dominant: 'dominantnu boju', secondary: 'sekundarnu boju', accent: 'akcentnu boju' },
    otherScheme: 'vrednost iz druge šeme sajta',
    contrastWarning: (fg: string, bg: string, ratio: string, target: string, toFg: string, toBg: string) =>
      `${fg} na ${bg}: kontrast ${ratio} < ${target} (${toFg} na ${toBg})`,
    roleHeading: {
      dominant: 'DOMINANTNA (60%)',
      secondary: 'SEKUNDARNA (30%)',
      accent: 'AKCENTNA (10%)',
      protected: 'NE MENJA SE',
    } satisfies Record<Role, string>,
    contrastFix: (before: string, after: string, against: string) => `⚖ kontrast ${before}→${after} na ${against}`,
    contrastHeading: '⚠ Kontrast:',
    background: 'pozadina',
    text: 'tekst',
    borders: 'ivice',
    interactive: 'interaktivno',
    unmeasured: 'bez izmerene površine (hover, @media, senke, skriveno)',
    implicitWhite: 'podrazumevana bela browsera',
    declared: 'deklarisano',
    stats: (elements: number, rules: number, declarations: number, ms: number) =>
      `Elemenata: ${elements} · CSS pravila: ${rules} · deklaracija boja: ${declarations} · ${ms} ms`,
    blockedSheets: '⚠ Nedostupni stylesheet-ovi (CORS):',
    colors: (n: number) => `${n} boja`,
  },
  en: {
    emptyPalette: 'The palette is empty — no colors to classify.',
    analyzeFirst: 'Call analyze() before apply().',
    nothingToExport: 'No palette has been applied, nothing to export.',
    badColor: (what: string, color: string) => `Invalid ${what}: "${color}"`,
    paletteColor: { dominant: 'dominant color', secondary: 'secondary color', accent: 'accent color' },
    otherScheme: "value from the site's other scheme",
    contrastWarning: (fg: string, bg: string, ratio: string, target: string, toFg: string, toBg: string) =>
      `${fg} on ${bg}: contrast ${ratio} < ${target} (${toFg} on ${toBg})`,
    roleHeading: {
      dominant: 'DOMINANT (60%)',
      secondary: 'SECONDARY (30%)',
      accent: 'ACCENT (10%)',
      protected: 'UNCHANGED',
    } satisfies Record<Role, string>,
    contrastFix: (before: string, after: string, against: string) => `⚖ contrast ${before}→${after} on ${against}`,
    contrastHeading: '⚠ Contrast:',
    background: 'background',
    text: 'text',
    borders: 'borders',
    interactive: 'interactive',
    unmeasured: 'no measured area (hover, @media, shadows, hidden)',
    implicitWhite: 'browser default white',
    declared: 'declared',
    stats: (elements: number, rules: number, declarations: number, ms: number) =>
      `Elements: ${elements} · CSS rules: ${rules} · color declarations: ${declarations} · ${ms} ms`,
    blockedSheets: '⚠ Unavailable stylesheets (CORS):',
    colors: (n: number) => `${n} colors`,
  },
};

export const coreText = (lang: Lang = 'sr') => CORE_TEXT[lang];
