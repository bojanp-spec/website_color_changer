import type { OKLCH } from '../color/types.js';

/** Uloge po pravilu 60-30-10. `protected` = boja se ne menja (semantičke boje, grafikoni, nepoznato). */
export type Role = 'dominant' | 'secondary' | 'accent' | 'protected';

/** Tri boje koje korisnik bira (bilo koji CSS zapis boje). */
export interface Palette {
  dominant: string;
  secondary: string;
  accent: string;
}

export interface RoleAssignment {
  key: string;
  role: Role;
  oklch: OKLCH;
  /** Kratko objašnjenje zašto je boja dobila ulogu — prikazuje se u UI/CLI. */
  reason: string;
  /** Izmerena vidljiva površina po vrsti upotrebe (0 za boje koje se trenutno ne vide). */
  usage: { bg: number; text: number; border: number };
  /**
   * `alt` = boja postoji samo u alternativnoj šemi sajta (npr. dark mode na svetlom sajtu).
   * Kod promene polariteta (svetla → tamna paleta) samo `main` boje obrću odnose svetline.
   */
  scheme: 'main' | 'alt';
  /** CSS varijable koje nose ovu boju. */
  variables: string[];
}

export interface Classification {
  /** Da li je glavna šema sajta svetla (dominantna boja L > 0.5). */
  light: boolean;
  /** Bazne boje uloga (kanonski ključevi). `accent` je `null` ako sajt nema izraženu akcentnu boju. */
  bases: { dominant: string; secondary: string; accent: string | null };
  /**
   * Bazne boje alternativne šeme (npr. dark mode svetlog sajta): boja iz te šeme koja deli
   * CSS varijablu sa baznom bojom (`--paper` u dark mode-u). `null` ako je nema.
   */
  altBases: { dominant: string | null; secondary: string | null; accent: string | null };
  roles: Map<string, RoleAssignment>;
}

/** Minimalni podskup rezultata skeniranja koji klasifikacija koristi — serijalizabilan (JSON). */
export interface ScanSummary {
  palette: {
    key: string;
    area: number;
    weight: { bgArea: number; textArea: number; borderArea: number; svgArea: number; interactiveArea: number };
    variables: string[];
  }[];
  usages: { source: string; property: string; value?: string; colors: string[]; selector?: string; conditions?: string[] }[];
  pairs: { fg: string; bg: string; minFontSize: number; hasSmallText: boolean; weight?: number }[];
}
