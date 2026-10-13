/**
 * Gamma-encoded sRGB color, channels in the 0..1 range.
 * Channels may fall outside [0,1] when the color comes from a wider space (lab, oklch, display-p3)
 * — this is resolved only at serialization (gamut mapping).
 */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

/** OKLCH: l 0..1, c >= 0 (practically up to ~0.4), h 0..360 degrees, a 0..1. */
export interface OKLCH {
  l: number;
  c: number;
  h: number;
  a: number;
}

/** OKLab: l 0..1, a/b roughly -0.4..0.4. */
export interface OKLab {
  l: number;
  a: number;
  b: number;
  alpha: number;
}

/** Syntactic form the color was written in — used to write the new color "in the same language". */
export type ColorFormat =
  | 'hex'
  | 'named'
  | 'rgb'
  | 'hsl'
  | 'hwb'
  | 'lab'
  | 'lch'
  | 'oklab'
  | 'oklch'
  | 'color';
