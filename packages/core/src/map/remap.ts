import { NEUTRAL_BASE_CHROMA } from '../analyze/classify.js';
import type { OKLCH } from '../color/types.js';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Hue difference in [-180, 180]. */
export function hueDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** Maximum allowed hue shift relative to the base (hover slightly toward purple, etc.). */
const MAX_HUE_SHIFT = 40;

/**
 * Phase 3: carries a color from the old palette into the new one, preserving its relation to the role's base color.
 *
 * - Lightness: keeps the difference from the base; compresses it when the new base has less "room"
 *   (e.g. a light tint of yellow must not go past white).
 * - Chroma: keeps the relation to the base (a pale variant stays pale). For (nearly) neutral bases
 *   the difference is scaled relative to 0.03, so tinted grays pick up the new hue without overdoing it.
 * - Hue: chromatic colors keep a small offset from the base; neutrals take the new base's hue.
 *
 * `mode` changes the direction of the lightness difference when the new palette has the opposite polarity to the site.
 *
 * The base color always maps exactly to the new base color. The result may be outside the sRGB gamut —
 * serialization gamut-maps it.
 */
export type LightnessMode =
  /** Keep the direction of the difference (default). */
  | 'keep'
  /** Invert the direction: text that was lighter than the base becomes darker (light ↔ dark scheme switch). */
  | 'invert'
  /** Always lighter than the base (surfaces and lines on a dark background). */
  | 'lighter'
  /** Always darker than the base (surfaces and lines on a light background). */
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
