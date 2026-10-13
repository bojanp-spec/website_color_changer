import type { Palette } from './types.js';

/** Gotove kombinacije (dominantna 60% / sekundarna 30% / akcentna 10%). */
export const PRESETS: Record<string, Palette> = {
  'crveno-sivo': { dominant: '#FAFAFA', secondary: '#4B4B4F', accent: '#D32F2F' },
  'zuto-zeleno': { dominant: '#FFFDF5', secondary: '#2E5E3E', accent: '#F2B705' },
  'zeleno-krem': { dominant: '#FBF8F1', secondary: '#3A4A3F', accent: '#2E9E5B' },
  'narandzasto-tamno': { dominant: '#121212', secondary: '#D0D0D0', accent: '#FF7A1A' },
  'ljubicasto-roze': { dominant: '#F8F6FC', secondary: '#352A55', accent: '#E0457B' },
  'tirkiz-okean': { dominant: '#F1F8FA', secondary: '#173B4D', accent: '#00A6A6' },
  'terakota-pesak': { dominant: '#F7F1E8', secondary: '#4A3A2F', accent: '#C8553D' },
  'grafit-plavo': { dominant: '#F7F8FA', secondary: '#2B2D31', accent: '#2F6BFF' },
  'ponoc-zlatno': { dominant: '#0E1525', secondary: '#DCE3EE', accent: '#F2B33D' },
};

/** Nazivi za prikaz (panel, uputstvo). */
export const PRESET_LABELS: Record<string, string> = {
  'crveno-sivo': 'Crveno / sivo',
  'zuto-zeleno': 'Žuto / zeleno',
  'zeleno-krem': 'Zeleno / krem',
  'narandzasto-tamno': 'Narandžasto / tamno',
  'ljubicasto-roze': 'Ljubičasto / roze',
  'tirkiz-okean': 'Tirkiz / okean',
  'terakota-pesak': 'Terakota / pesak',
  'grafit-plavo': 'Grafit / električno plava',
  'ponoc-zlatno': 'Ponoć / zlatno',
};
