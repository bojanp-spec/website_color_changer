/** Why a color got its role — a code (for translation in the UI) and Serbian/English text. */
export type ReasonCode =
  | 'manual'
  | 'largest-background'
  | 'most-text'
  | 'vivid-interactive'
  | 'non-paint'
  | 'multicolor-svg'
  | 'protected-variable'
  | 'vivid-accent-hue'
  | 'accent-hue-large-text'
  | 'accent-hue-structure'
  | 'foreign-hue'
  | 'vivid-other'
  | 'accent-tint'
  | 'text'
  | 'near-dominant'
  | 'near-secondary'
  | 'inherited-variable'
  | 'declared-text'
  | 'declared-lightness'
  | 'translucent-variant'
  | 'translucent-lightness';

export type ReasonLang = 'sr' | 'en';

/** `{arg}` is replaced with extra data (variable name, color…). */
export const REASONS: Record<ReasonLang, Record<ReasonCode, string>> = {
  sr: {
    manual: 'ručno podešeno',
    'largest-background': 'najveća površina pozadine',
    'most-text': 'najviše teksta',
    'vivid-interactive': 'živa boja na interaktivnim elementima',
    'non-paint': 'samo maska / color-mix() / senka',
    'multicolor-svg': 'višebojna SVG grafika (logo)',
    'protected-variable': 'zaštićena varijabla ({arg})',
    'vivid-accent-hue': 'živa boja u nijansi akcenta',
    'accent-hue-large-text': 'tekst u nijansi akcenta (velika površina)',
    'accent-hue-structure': 'velika površina u nijansi akcenta → struktura',
    'foreign-hue': 'nijansa van palete sajta (semantička/ostala boja)',
    'vivid-other': 'živa boja van akcenta',
    'accent-tint': 'svetla/tamna nijansa akcenta',
    text: 'tekst',
    'near-dominant': 'pozadina/struktura bliska dominantnoj',
    'near-secondary': 'tamna/struktura bliska sekundarnoj',
    'inherited-variable': 'nasleđeno preko {arg} (npr. dark mode/hover)',
    'declared-text': 'tekst (deklarisano)',
    'declared-lightness': 'po svetlini (deklarisano)',
    'translucent-variant': 'providna varijanta {arg}',
    'translucent-lightness': 'providna, po svetlini',
  },
  en: {
    manual: 'set manually',
    'largest-background': 'largest background area',
    'most-text': 'most text',
    'vivid-interactive': 'vivid color on interactive elements',
    'non-paint': 'only a mask / color-mix() / shadow',
    'multicolor-svg': 'multicolor SVG graphic (logo)',
    'protected-variable': 'protected variable ({arg})',
    'vivid-accent-hue': 'vivid color in the accent hue',
    'accent-hue-large-text': 'text in the accent hue (large area)',
    'accent-hue-structure': 'large area in the accent hue → structure',
    'foreign-hue': "hue outside the site's palette (semantic/other color)",
    'vivid-other': 'vivid color outside the accent',
    'accent-tint': 'light/dark tint of the accent',
    text: 'text',
    'near-dominant': 'background/structure close to the dominant color',
    'near-secondary': 'dark/structure close to the secondary color',
    'inherited-variable': 'inherited via {arg} (e.g. dark mode/hover)',
    'declared-text': 'text (declared)',
    'declared-lightness': 'by lightness (declared)',
    'translucent-variant': 'translucent variant of {arg}',
    'translucent-lightness': 'translucent, by lightness',
  },
};

export function reasonText(code: ReasonCode, arg?: string, lang: ReasonLang = 'sr'): string {
  return REASONS[lang][code].replace('{arg}', arg ?? '');
}
