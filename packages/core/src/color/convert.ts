import type { OKLCH, OKLab, RGBA } from './types.js';

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];

const mul = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

// ---------------------------------------------------------------------------
// Transfer funkcije (sRGB i display-p3 dele istu krivu)
// ---------------------------------------------------------------------------

export function srgbToLinear(c: number): number {
  const s = Math.sign(c) || 1;
  const x = Math.abs(c);
  return x <= 0.04045 ? c / 12.92 : s * ((x + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(c: number): number {
  const s = Math.sign(c) || 1;
  const x = Math.abs(c);
  return x <= 0.0031308 ? c * 12.92 : s * (1.055 * x ** (1 / 2.4) - 0.055);
}

// ---------------------------------------------------------------------------
// Matrice (CSS Color 4)
// ---------------------------------------------------------------------------

const LIN_SRGB_TO_XYZ_D65: Mat3 = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
const XYZ_D65_TO_LIN_SRGB: Mat3 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const LIN_P3_TO_XYZ_D65: Mat3 = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];
const D50_TO_D65: Mat3 = [
  [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
  [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
  [0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
];

// ---------------------------------------------------------------------------
// Ulazni prostori → sRGB
// ---------------------------------------------------------------------------

function linearSrgbVecToRgba(v: Vec3, a: number): RGBA {
  return { r: linearToSrgb(v[0]), g: linearToSrgb(v[1]), b: linearToSrgb(v[2]), a };
}

export function xyzD65ToRgb(x: number, y: number, z: number, a = 1): RGBA {
  return linearSrgbVecToRgba(mul(XYZ_D65_TO_LIN_SRGB, [x, y, z]), a);
}

export function xyzD50ToRgb(x: number, y: number, z: number, a = 1): RGBA {
  const [X, Y, Z] = mul(D50_TO_D65, [x, y, z]);
  return xyzD65ToRgb(X, Y, Z, a);
}

export function linearSrgbToRgb(r: number, g: number, b: number, a = 1): RGBA {
  return linearSrgbVecToRgba([r, g, b], a);
}

export function displayP3ToRgb(r: number, g: number, b: number, a = 1): RGBA {
  const [x, y, z] = mul(LIN_P3_TO_XYZ_D65, [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]);
  return xyzD65ToRgb(x, y, z, a);
}

const D50_WHITE: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const KAPPA = 24389 / 27;
const EPSILON = 216 / 24389;

/** CIE Lab (D50, kako ga definiše CSS). L 0..100. */
export function labToRgb(L: number, A: number, B: number, alpha = 1): RGBA {
  const f1 = (L + 16) / 116;
  const f0 = A / 500 + f1;
  const f2 = f1 - B / 200;
  const x = f0 ** 3 > EPSILON ? f0 ** 3 : (116 * f0 - 16) / KAPPA;
  const y = L > KAPPA * EPSILON ? f1 ** 3 : L / KAPPA;
  const z = f2 ** 3 > EPSILON ? f2 ** 3 : (116 * f2 - 16) / KAPPA;
  return xyzD50ToRgb(x * D50_WHITE[0], y * D50_WHITE[1], z * D50_WHITE[2], alpha);
}

export function lchToRgb(L: number, C: number, H: number, alpha = 1): RGBA {
  const h = (H * Math.PI) / 180;
  return labToRgb(L, C * Math.cos(h), C * Math.sin(h), alpha);
}

/** HSL → sRGB. h u stepenima, s i l u 0..1. */
export function hslToRgb(h: number, s: number, l: number, a = 1): RGBA {
  h = ((h % 360) + 360) % 360;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: f(0), g: f(8), b: f(4), a };
}

/** HWB → sRGB. h u stepenima, w i bl u 0..1. */
export function hwbToRgb(h: number, w: number, bl: number, a = 1): RGBA {
  if (w + bl >= 1) {
    const gray = w / (w + bl);
    return { r: gray, g: gray, b: gray, a };
  }
  const base = hslToRgb(h, 1, 0.5);
  const k = 1 - w - bl;
  return { r: base.r * k + w, g: base.g * k + w, b: base.b * k + w, a };
}

export function rgbToHsl({ r, g, b, a }: RGBA): { h: number; s: number; l: number; a: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l === 0 || l === 1 ? 0 : (max - l) / Math.min(l, 1 - l);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h, s, l, a };
}

// ---------------------------------------------------------------------------
// OKLab / OKLCH (Björn Ottosson)
// ---------------------------------------------------------------------------

export function rgbToOklab({ r, g, b, a }: RGBA): OKLab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    alpha: a,
  };
}

export function oklabToRgb({ l: L, a: A, b: B, alpha }: OKLab): RGBA {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return linearSrgbVecToRgba(
    [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ],
    alpha,
  );
}

/** Ispod ove hrome nijansa nema smisla (ahromatska boja) i vraća se h = 0. */
const ACHROMATIC_C = 1e-4;

export function oklabToOklch({ l, a, b, alpha }: OKLab): OKLCH {
  const c = Math.hypot(a, b);
  const h = c < ACHROMATIC_C ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l, c, h, a: alpha };
}

export function oklchToOklab({ l, c, h, a }: OKLCH): OKLab {
  const rad = (h * Math.PI) / 180;
  return { l, a: c * Math.cos(rad), b: c * Math.sin(rad), alpha: a };
}

export function rgbToOklch(rgba: RGBA): OKLCH {
  return oklabToOklch(rgbToOklab(rgba));
}

/** Bez gamut mapiranja — rezultat može biti van sRGB. Za prikaz koristi {@link oklchToRgbInGamut}. */
export function oklchToRgb(lch: OKLCH): RGBA {
  return oklabToRgb(oklchToOklab(lch));
}

// ---------------------------------------------------------------------------
// Gamut
// ---------------------------------------------------------------------------

const GAMUT_EPS = 1e-6;

export function inSrgbGamut({ r, g, b }: RGBA): boolean {
  return [r, g, b].every((v) => v >= -GAMUT_EPS && v <= 1 + GAMUT_EPS);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function clipRgb({ r, g, b, a }: RGBA): RGBA {
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b), a: clamp01(a) };
}

/** Perceptualna razlika dve boje u OKLab prostoru (ΔE_OK). ~0.02 je prag primetnosti. */
export function deltaEOK(x: RGBA, y: RGBA): number {
  const p = rgbToOklab(x);
  const q = rgbToOklab(y);
  return Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b);
}

const JND = 0.02;

/**
 * OKLCH → sRGB uz gamut mapiranje po CSS Color 4 algoritmu:
 * svetlina i nijansa se čuvaju, hroma se smanjuje dok boja ne uđe u sRGB.
 */
export function oklchToRgbInGamut(lch: OKLCH): RGBA {
  const a = clamp01(lch.a);
  if (lch.l >= 1) return { r: 1, g: 1, b: 1, a };
  if (lch.l <= 0) return { r: 0, g: 0, b: 0, a };

  const direct = oklchToRgb({ ...lch, a });
  if (inSrgbGamut(direct)) return clipRgb(direct);

  let lo = 0;
  let hi = lch.c;
  let best = clipRgb(oklchToRgb({ ...lch, c: 0, a }));
  while (hi - lo > 1e-4) {
    const mid = (lo + hi) / 2;
    const candidate = oklchToRgb({ ...lch, c: mid, a });
    if (inSrgbGamut(candidate)) {
      lo = mid;
      best = clipRgb(candidate);
      continue;
    }
    const clipped = clipRgb(candidate);
    if (deltaEOK(clipped, candidate) < JND) return clipped;
    hi = mid;
  }
  return best;
}

/** Svodi bilo koju (moguće van-gamut) boju u sRGB, čuvajući L i H. */
export function toSrgbGamut(rgba: RGBA): RGBA {
  return inSrgbGamut(rgba) ? clipRgb(rgba) : oklchToRgbInGamut(rgbToOklch(rgba));
}
