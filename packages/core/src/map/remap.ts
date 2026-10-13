import { NEUTRAL_BASE_CHROMA } from '../analyze/classify.js';
import type { OKLCH } from '../color/types.js';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Razlika nijansi u [-180, 180]. */
export function hueDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** Najveći dozvoljeni pomak nijanse u odnosu na bazu (hover blago ka ljubičastoj i sl.). */
const MAX_HUE_SHIFT = 40;

/**
 * Faza 3: prenosi boju iz stare palete u novu, čuvajući njen odnos prema baznoj boji uloge.
 *
 * - Svetlina: zadržava razliku od baze; kompresuje je kad nova baza ima manje „prostora"
 *   (npr. svetla nijansa žute ne sme preći belu).
 * - Hroma: zadržava odnos prema bazi (bleda varijanta ostaje bleda). Za (skoro) neutralne baze
 *   razlika se skalira prema 0.03, pa obojene sive dobijaju nijansu nove boje, a ne preteruju.
 * - Nijansa: obojene boje zadržavaju mali pomak od baze; neutralne preuzimaju nijansu nove baze.
 *
 * `mode` menja smer razlike svetline kad nova paleta ima suprotan polaritet od sajta.
 *
 * Bazna boja se uvek preslikava tačno u novu baznu boju. Rezultat može biti van sRGB gamuta —
 * serijalizacija ga gamut-mapira.
 */
export type LightnessMode =
  /** Zadrži smer razlike (podrazumevano). */
  | 'keep'
  /** Obrni smer: tekst koji je bio svetliji od baze postaje tamniji (promena svetla ↔ tamna šema). */
  | 'invert'
  /** Uvek svetlije od baze (površine i linije na tamnoj pozadini). */
  | 'lighter'
  /** Uvek tamnije od baze (površine i linije na svetloj pozadini). */
  | 'darker';

export function remap(orig: OKLCH, oldBase: OKLCH, newBase: OKLCH, mode: LightnessMode = 'keep'): OKLCH {
  const raw = orig.l - oldBase.l;
  const dL = mode === 'invert' ? -raw : mode === 'lighter' ? Math.abs(raw) : mode === 'darker' ? -Math.abs(raw) : raw;
  const roomOld = dL > 0 ? 1 - oldBase.l : oldBase.l;
  const roomNew = dL > 0 ? 1 - newBase.l : newBase.l;
  const scale = roomOld > 1e-6 ? Math.min(1, roomNew / roomOld) : 1;
  const l = clamp(newBase.l + dL * scale, 0, 1);

  const k = newBase.c / Math.max(oldBase.c, NEUTRAL_BASE_CHROMA);
  const c = Math.max(0, newBase.c + (orig.c - oldBase.c) * k);

  const dH = orig.c >= NEUTRAL_BASE_CHROMA && oldBase.c >= NEUTRAL_BASE_CHROMA ? clamp(hueDelta(oldBase.h, orig.h), -MAX_HUE_SHIFT, MAX_HUE_SHIFT) : 0;
  const h = (((newBase.h + dH) % 360) + 360) % 360;

  return { l, c, h, a: orig.a };
}
