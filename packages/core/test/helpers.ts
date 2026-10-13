import { expect } from 'vitest';
import type { RGBA } from '../src/index.js';

/** Compares a color on the 0..255 scale with a tolerance (in byte units). */
export function expectRgb(actual: RGBA | null | undefined, expected: [number, number, number, number?], tol = 0.6) {
  expect(actual).toBeTruthy();
  const a = actual!;
  const [r, g, b, alpha = 1] = expected;
  expect(Math.abs(a.r * 255 - r)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.g * 255 - g)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.b * 255 - b)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.a - alpha)).toBeLessThanOrEqual(0.002);
}
