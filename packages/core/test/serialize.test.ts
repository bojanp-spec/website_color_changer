import { describe, expect, it } from 'vitest';
import { formatLike, parseColor, replaceColors, toHex, toHslString, toOklchString, toRgbString } from '../src/index.js';
import type { RGBA } from '../src/index.js';

const RED: RGBA = { r: 0.8, g: 0.2, b: 0.2, a: 1 };

describe('serijalizacija', () => {
  it('toHex', () => {
    expect(toHex({ r: 1, g: 0, b: 0.5, a: 1 })).toBe('#ff0080');
    expect(toHex({ r: 1, g: 0, b: 0, a: 0.5 })).toBe('#ff000080');
    expect(toHex({ r: 1, g: 0, b: 0, a: 1 }, { upper: true })).toBe('#FF0000');
  });

  it('toHex gamut-mapira boje van sRGB', () => {
    const p3 = parseColor('color(display-p3 0 1 0)')!.rgba;
    expect(toHex(p3)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('toRgbString — moderna i stara sintaksa', () => {
    expect(toRgbString(RED)).toBe('rgb(204 51 51)');
    expect(toRgbString({ ...RED, a: 0.5 })).toBe('rgb(204 51 51 / 0.5)');
    expect(toRgbString(RED, { legacy: true })).toBe('rgb(204, 51, 51)');
    expect(toRgbString({ ...RED, a: 0.5 }, { legacy: true })).toBe('rgba(204, 51, 51, 0.5)');
  });

  it('toHslString', () => {
    expect(toHslString(RED)).toBe('hsl(0 60% 50%)');
    expect(toHslString({ ...RED, a: 0.25 }, { legacy: true })).toBe('hsla(0, 60%, 50%, 0.25)');
  });

  it('toOklchString', () => {
    expect(toOklchString({ r: 1, g: 0, b: 0, a: 1 })).toBe('oklch(62.8% 0.2577 29.23)');
    expect(toOklchString({ r: 1, g: 1, b: 1, a: 0.5 })).toBe('oklch(100% 0 0 / 0.5)');
  });
});

describe('formatLike — nova boja u formatu originala', () => {
  it.each([
    ['#1E3A8A', '#CC3333'],
    ['#1e3a8a', '#cc3333'],
    ['navy', '#cc3333'],
    ['rgba(30, 58, 138, 1)', 'rgb(204, 51, 51)'],
    ['rgb(30 58 138)', 'rgb(204 51 51)'],
    ['hsl(220, 64%, 33%)', 'hsl(0, 60%, 50%)'],
    ['oklch(40% 0.1 260)', 'oklch(55.94% 0.19 25.86)'],
  ])('%s → %s', (orig, expected) => {
    expect(formatLike(parseColor(orig)!, RED)).toBe(expected);
  });

  it('round-trip: formatLike(original, original) ne menja HEX i rgb vrednosti', () => {
    for (const s of ['#1e3a8a', '#1E3A8A80', 'rgb(30 58 138 / 0.5)', 'rgba(30, 58, 138, 0.5)']) {
      const p = parseColor(s)!;
      expect(parseColor(formatLike(p, p.rgba))!.rgba).toEqual(p.rgba);
    }
  });

  it('kombinovano sa replaceColors', () => {
    const css = '1px solid #1E3A8A';
    expect(replaceColors(css, (c) => formatLike(c, RED))).toBe('1px solid #CC3333');
  });
});
