// Tekstovi stranice sa podešavanjima. Jezik se bira pri build-u (esbuild `define`).
declare const __CC_LANG__: 'sr' | 'en' | undefined;
export const LANG: 'sr' | 'en' = typeof __CC_LANG__ !== 'undefined' && __CC_LANG__ === 'en' ? 'en' : 'sr';

const STRINGS = {
  sr: {
    pageTitle: 'Website Color Changer — podešavanja',
    intro: 'Klik na ikonicu ekstenzije otvara panel na trenutnom sajtu. <kbd>Alt+C</kbd> u panelu prebacuje original ↔ nova paleta.',
    accessTitle: 'Pristup sajtovima',
    accessExplain:
      'Bez ove dozvole ekstenzija radi samo kad klikneš ikonicu, i samo na tom tabu. Sa njom: (1) čita stilove sa drugih domena (CDN) koje sajt ne deli preko CORS-a, i (2) automatski primenjuje sačuvanu paletu na sajtovima gde to uključiš.',
    grant: 'Dozvoli pristup svim sajtovima',
    revoke: 'Ukloni dozvolu',
    granted: '✓ Dozvoljeno: stilovi sa drugih domena i automatska primena rade na svim sajtovima.',
    notGranted: 'Ekstenzija trenutno radi samo na klik (dozvola „activeTab").',
    needPermission: 'Za automatsku primenu potrebna je dozvola za pristup sajtovima.',
    savedTitle: 'Sačuvane palete',
    empty: 'Još nema sačuvanih paleta. Otvori panel na nekom sajtu i izaberi boje.',
    auto: 'automatski',
    delete: 'Obriši',
  },
  en: {
    pageTitle: 'Website Color Changer — settings',
    intro: 'Clicking the extension icon opens the panel on the current site. <kbd>Alt+C</kbd> in the panel switches between the original and the new palette.',
    accessTitle: 'Site access',
    accessExplain:
      "Without this permission the extension only works when you click its icon, and only on that tab. With it: (1) it reads styles from other domains (CDNs) that the site doesn't share via CORS, and (2) it automatically applies the saved palette on sites where you turn that on.",
    grant: 'Allow access to all sites',
    revoke: 'Remove permission',
    granted: '✓ Allowed: styles from other domains and automatic apply work on all sites.',
    notGranted: 'The extension currently works only on click (the “activeTab” permission).',
    needPermission: 'Automatic apply needs permission to access sites.',
    savedTitle: 'Saved palettes',
    empty: 'No saved palettes yet. Open the panel on a site and pick colors.',
    auto: 'automatic',
    delete: 'Delete',
  },
} satisfies Record<'sr' | 'en', Record<string, string>>;

export type OptionsKey = keyof (typeof STRINGS)['sr'];
export const t = (key: OptionsKey): string => STRINGS[LANG][key];
