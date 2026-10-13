export type UsageSource = 'cssom' | 'inline' | 'variable' | 'svg-attr' | 'html-attr';

/** Jedno mesto u kodu sajta gde je deklarisana boja (ili referenca na varijablu boje). */
export interface Usage {
  source: UsageSource;
  /** CSS svojstvo (`background-color`, `--brand`) ili ime atributa (`fill`, `bgcolor`). */
  property: string;
  /** Cela deklarisana vrednost, bajt-identična originalu. */
  value: string;
  /** Konkretne boje pronađene u vrednosti, kao kanonski ključ (`#rrggbb` / `#rrggbbaa`). */
  colors: string[];
  /** Varijable na koje vrednost upućuje (`var(--primary)` → `--primary`). */
  varRefs: string[];
  /** Selektor pravila (za `cssom`/`variable` iz stylesheet-a). Za ugnježdena pravila — unutrašnji. */
  selector?: string;
  /** Spoljni selektori kod CSS nesting-a, od najspoljnijeg ka unutrašnjem. */
  nesting?: string[];
  /** Grupni uslovi, spolja ka unutra: `@media (max-width: 600px)`, `@supports …`, `@layer base`. */
  conditions: string[];
  important: boolean;
  /** Identifikator stylesheet-a (vidi {@link SheetReport.id}). */
  sheet?: string;
  /** Element za inline stil / atribut. Ne serijalizuje se. */
  element?: Element;
}

export type SheetStatus = 'ok' | 'refetched' | 'blocked';

export interface SheetReport {
  /** `href` za eksterne, inače `style#<n>` / `adopted#<n>` (sa prefiksom shadow hosta). */
  id: string;
  href: string | null;
  owner: 'link' | 'style' | 'import' | 'adopted';
  status: SheetStatus;
  /** Ukupan broj pregledanih pravila, uključujući ugnježdena. */
  ruleCount: number;
}

/** Koliko ekrana boja pokriva, po vrsti upotrebe. Jedinice: px² (tekst: aproksimacija „mastila"). */
export interface ColorWeight {
  key: string;
  bgArea: number;
  textArea: number;
  borderArea: number;
  svgArea: number;
  /** Deo gornjih površina koji pripada interaktivnim elementima (dugmad, linkovi, CTA). */
  interactiveArea: number;
  elementCount: number;
  /** Boja platna koju sajt nije deklarisao (podrazumevana bela pozadina browsera). */
  implicit?: boolean;
}

/** Par tekst/pozadina zatečen na stranici — za proveru kontrasta posle remapiranja. */
export interface ContrastPair {
  fg: string;
  bg: string;
  /** Težina teksta (isto kao `textArea`). */
  weight: number;
  /** Najmanji font na kome se par javlja (najstroži zahtev kontrasta). */
  minFontSize: number;
  /** Da li se par javlja i kao „mali" tekst (WCAG prag 4.5 umesto 3). */
  hasSmallText: boolean;
}

export interface PaletteEntry {
  key: string;
  /** Ukupna vidljiva površina (bg + text + border + svg). */
  area: number;
  /** Udeo u ukupnoj vidljivoj površini, 0..1. */
  share: number;
  weight: ColorWeight;
  /** Koliko puta se boja javlja u deklaracijama, po izvoru. */
  declared: Partial<Record<UsageSource, number>>;
  /** Varijable čija vrednost sadrži ovu boju. */
  variables: string[];
}

export interface ScanResult {
  usages: Usage[];
  sheets: SheetReport[];
  weights: ColorWeight[];
  pairs: ContrastPair[];
  palette: PaletteEntry[];
  stats: { elements: number; rules: number; durationMs: number };
}
