import type { Palette } from './types.js';

/** Gotove kombinacije (dominantna / sekundarna / akcentna). */
export const PRESETS: Record<string, Palette> = {
  'crveno-sivo': { dominant: '#FAFAFA', secondary: '#4B4B4F', accent: '#D32F2F' },
  'zuto-zeleno': { dominant: '#FFFDF5', secondary: '#2E5E3E', accent: '#F2B705' },
  'zeleno-krem': { dominant: '#FBF8F1', secondary: '#3A4A3F', accent: '#2E9E5B' },
  'narandzasto-tamno': { dominant: '#121212', secondary: '#D0D0D0', accent: '#FF7A1A' },
};
