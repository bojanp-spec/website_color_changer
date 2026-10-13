import { describe, expect, it } from 'vitest';
import { hueDelta, parseColor, remap, rgbToOklch } from '../src/index.js';
import type { OKLCH } from '../src/index.js';

const o = (s: string): OKLCH => rgbToOklch(parseColor(s)!.rgba);

describe('remap', () => {
  const oldBase = o('#3e9fd9');
  const newBase = o('#d32f2f');

  it('the base maps exactly onto the new base', () => {
    const r = remap(oldBase, oldBase, newBase);
    expect(r.l).toBeCloseTo(newBase.l, 10);
    expect(r.c).toBeCloseTo(newBase.c, 10);
    expect(r.h).toBeCloseTo(newBase.h, 10);
  });

  it('preserves lightness order within a role', () => {
    const shades = ['#e7f2fa', '#6cc0f0', '#3e9fd9', '#1b6fa8', '#13293d'].map(o);
    const mapped = shades.map((s) => remap(s, oldBase, newBase));
    for (let i = 1; i < mapped.length; i++) expect(mapped[i]!.l).toBeLessThan(mapped[i - 1]!.l);
  });

  it('a pale variant stays pale, alpha is preserved', () => {
    const wash = { ...o('#e7f2fa'), a: 0.4 };
    const r = remap(wash, oldBase, newBase);
    expect(r.c).toBeLessThan(newBase.c / 3);
    expect(r.a).toBe(0.4);
  });

  it('tinted grays take on the hue of the new (neutral) base', () => {
    const navy = o('#10233f');
    const r = remap(o('#4c5975'), navy, o('#2e5e3e'));
    expect(Math.abs(hueDelta(r.h, o('#2e5e3e').h))).toBeLessThan(15);
    // onto an achromatic base → gray
    expect(remap(o('#4c5975'), navy, o('#4b4b4f')).c).toBeLessThan(0.01);
  });

  it('lightness stays within [0,1] when the new base has no headroom', () => {
    const r = remap(o('#e7f2fa'), oldBase, o('#f2b705'));
    expect(r.l).toBeLessThanOrEqual(1);
    expect(r.l).toBeGreaterThan(o('#f2b705').l);
  });

  it('lightness modes', () => {
    const base = o('#f4f6fa');
    const darkerShade = o('#dde3ee');
    const nb = o('#121212');
    expect(remap(darkerShade, base, nb, 'keep').l).toBeLessThan(nb.l);
    expect(remap(darkerShade, base, nb, 'lighter').l).toBeGreaterThan(nb.l);
    expect(remap(darkerShade, base, nb, 'invert').l).toBeGreaterThan(nb.l);
  });

  it('hueDelta', () => {
    expect(hueDelta(350, 10)).toBe(20);
    expect(hueDelta(10, 350)).toBe(-20);
    expect(hueDelta(0, 180)).toBe(-180);
  });
});
