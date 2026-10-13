/**
 * sRGB boja sa gama korekcijom, kanali u opsegu 0..1.
 * Kanali mogu biti van [0,1] kada boja potiče iz šireg prostora (lab, oklch, display-p3)
 * — to se rešava tek pri serijalizaciji (gamut mapping).
 */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

/** OKLCH: l 0..1, c >= 0 (praktično do ~0.4), h 0..360 stepeni, a 0..1. */
export interface OKLCH {
  l: number;
  c: number;
  h: number;
  a: number;
}

/** OKLab: l 0..1, a/b približno -0.4..0.4. */
export interface OKLab {
  l: number;
  a: number;
  b: number;
  alpha: number;
}

/** Sintaksni oblik u kom je boja zapisana — koristi se da se nova boja zapiše „istim jezikom". */
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
