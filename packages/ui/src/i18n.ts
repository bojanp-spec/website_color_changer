import { PRESET_LABELS, PRESET_LABELS_EN, reasonText } from '@cc/core';
import type { ReasonCode, Role } from '@cc/core';

export type Lang = 'sr' | 'en';

// The language is chosen at build time (esbuild `define`); without it (tests, tsc) — Serbian.
declare const __CC_LANG__: Lang | undefined;
export const LANG: Lang = typeof __CC_LANG__ !== 'undefined' && __CC_LANG__ === 'en' ? 'en' : 'sr';

const STRINGS = {
  sr: {
    title: '🎨 Boje sajta',
    collapse: 'Skupi / raširi',
    collapseLabel: 'Skupi panel',
    close: 'Zatvori i vrati original',
    closeLabel: 'Zatvori',
    loading: 'Analiziram boje sajta…',
    analysisFailed: 'Analiza nije uspela: {0}',
    siteColors: 'Boje sajta',
    newPalette: 'Nova paleta',
    presets: 'Gotove palete',
    original: 'Original',
    export: 'Izvoz',
    copyCss: 'Kopiraj CSS',
    downloadCss: 'Preuzmi .css',
    copyLink: 'Kopiraj link',
    copied: 'Kopirano ✓',
    linkCopied: 'Link kopiran ✓',
    autoApply: 'Automatski primeni na ovom sajtu',
    showOriginal: 'Prikaži original',
    showNew: 'Prikaži novu paletu',
    apply: 'Primeni paletu',
    originalShown: 'Prikazan je original sajta.',
    pickColors: 'Izaberi boje ili gotovu paletu.',
    applied: 'Primenjeno: {0} boja',
    contrastFixes: '{0} korekcija kontrasta',
    contrastLow: '⚠ Kontrast ispod cilja: {0}',
    onBg: '{0} na {1}',
    more: 'još {0}',
    roleOf: 'Uloga boje {0}',
    roleChanged: 'Uloga boje {0} je promenjena. Videćeš razliku kad primeniš novu paletu (Alt+C).',
    roleHint: 'Uloga određuje koju boju iz „Nove palete" ova boja dobija kada je paleta primenjena.',
    colorLabel: '{0} boja',
    hexLabel: '{0} HEX',
    dominant: 'Dominantna',
    secondary: 'Sekundarna',
    accent: 'Akcentna',
    roleDominant: 'Dominantna (60%)',
    roleSecondary: 'Sekundarna (30%)',
    roleAccent: 'Akcentna (10%)',
    roleProtected: 'Ne menja se',
    brightness: 'Svetlina',
    contrast: 'Kontrast',
    resetSlider: 'Vrati na 0',
    slidersHint: 'Menjaju samo nove boje (slike i logotipi ostaju isti). Kontrast teksta ne pada ispod WCAG AA.',
    fileSuffix: 'paleta',
    fileFallback: 'sajt',
  },
  en: {
    title: '🎨 Site colors',
    collapse: 'Collapse / expand',
    collapseLabel: 'Collapse panel',
    close: 'Close and restore the original',
    closeLabel: 'Close',
    loading: "Analyzing the site's colors…",
    analysisFailed: 'Analysis failed: {0}',
    siteColors: 'Site colors',
    newPalette: 'New palette',
    presets: 'Ready-made palettes',
    original: 'Original',
    export: 'Export',
    copyCss: 'Copy CSS',
    downloadCss: 'Download .css',
    copyLink: 'Copy link',
    copied: 'Copied ✓',
    linkCopied: 'Link copied ✓',
    autoApply: 'Apply automatically on this site',
    showOriginal: 'Show original',
    showNew: 'Show new palette',
    apply: 'Apply palette',
    originalShown: 'Showing the original site.',
    pickColors: 'Pick colors or a ready-made palette.',
    applied: 'Applied: {0} colors',
    contrastFixes: '{0} contrast fixes',
    contrastLow: '⚠ Contrast below target: {0}',
    onBg: '{0} on {1}',
    more: '{0} more',
    roleOf: 'Role of color {0}',
    roleChanged: 'The role of {0} has changed. You will see the difference when you apply a new palette (Alt+C).',
    roleHint: 'The role decides which color from the “New palette” this color gets when the palette is applied.',
    colorLabel: '{0} color',
    hexLabel: '{0} HEX',
    dominant: 'Dominant',
    secondary: 'Secondary',
    accent: 'Accent',
    roleDominant: 'Dominant (60%)',
    roleSecondary: 'Secondary (30%)',
    roleAccent: 'Accent (10%)',
    roleProtected: 'Unchanged',
    brightness: 'Brightness',
    contrast: 'Contrast',
    resetSlider: 'Reset to 0',
    slidersHint: "They only change the new colors (images and logos stay the same). Text contrast doesn't drop below WCAG AA.",
    fileSuffix: 'palette',
    fileFallback: 'site',
  },
} satisfies Record<Lang, Record<string, string>>;

export type StringKey = keyof (typeof STRINGS)['sr'];

/** Translation with `{0}`, `{1}`… substitution */
export function t(key: StringKey, ...args: (string | number)[]): string {
  return STRINGS[LANG][key].replace(/\{(\d)\}/g, (_, i: string) => String(args[Number(i)] ?? ''));
}

export function roleName(role: Role): string {
  return t(({ dominant: 'roleDominant', secondary: 'roleSecondary', accent: 'roleAccent', protected: 'roleProtected' } as const)[role]);
}

export function presetLabel(id: string): string {
  return (LANG === 'en' ? PRESET_LABELS_EN : PRESET_LABELS)[id] ?? id;
}

export function reason(r: { reason: string; reasonCode: ReasonCode; reasonArg?: string }): string {
  return LANG === 'en' ? reasonText(r.reasonCode, r.reasonArg, 'en') : r.reason;
}
