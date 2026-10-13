import { describe, expect, it } from 'vitest';
import { parseColor } from '../src/index.js';
import { expectRgb } from './helpers.js';

const rgbOf = (s: string) => parseColor(s)?.rgba;

describe('parseColor — hex', () => {
  it.each([
    ['#fff', [255, 255, 255]],
    ['#1e3a8a', [30, 58, 138]],
    ['#1E3A8A', [30, 58, 138]],
    ['#0f08', [0, 255, 0, 0x88 / 255]],
    ['#1e3a8a80', [30, 58, 138, 0x80 / 255]],
  ] as const)('%s', (input, expected) => {
    expectRgb(rgbOf(input), [...expected] as [number, number, number, number?], 0.01);
  });

  it('pamti format i velika slova', () => {
    expect(parseColor('#1E3A8A')).toMatchObject({ format: 'hex', upper: true });
    expect(parseColor('#1e3a8a')).toMatchObject({ format: 'hex', upper: false });
    expect(parseColor('#123')).toMatchObject({ upper: false });
  });

  it.each(['#ff', '#fffff', '#ggg', '#', '#1234567'])('odbija %s', (input) => {
    expect(parseColor(input)).toBeNull();
  });
});

describe('parseColor — imenovane i ključne reči', () => {
  it('imenovane boje, bez obzira na velika slova', () => {
    expectRgb(rgbOf('SteelBlue'), [70, 130, 180], 0.01);
    expect(parseColor('red')?.format).toBe('named');
  });

  it.each(['transparent', 'currentColor', 'inherit', 'Canvas', 'solid', 'none'])('vraća null za %s', (s) => {
    expect(parseColor(s)).toBeNull();
  });
});

describe('parseColor — rgb()', () => {
  it.each([
    ['rgb(30, 58, 138)', [30, 58, 138]],
    ['rgba(30, 58, 138, 0.5)', [30, 58, 138, 0.5]],
    ['rgba(30,58,138,50%)', [30, 58, 138, 0.5]],
    ['rgb(30 58 138)', [30, 58, 138]],
    ['rgb(30 58 138 / .25)', [30, 58, 138, 0.25]],
    ['rgb(100% 0% 50%)', [255, 0, 127.5]],
    ['RGB(300 -5 none)', [255, 0, 0]],
    ['rgba(30 58 138)', [30, 58, 138]],
    ['rgb(1e2 0 0)', [100, 0, 0]],
  ] as const)('%s', (input, expected) => {
    expectRgb(rgbOf(input), [...expected] as [number, number, number, number?], 0.01);
  });

  it('beleži staru sintaksu sa zarezima', () => {
    expect(parseColor('rgb(1, 2, 3)')?.legacy).toBe(true);
    expect(parseColor('rgb(1 2 3)')?.legacy).toBeUndefined();
  });

  it.each([
    'rgb(1, 2)',
    'rgb(1, 2%, 3)', // mešanje broja i procenta u staroj sintaksi
    'rgb(1, 2, 3 / 0.5)',
    'rgb(1 2 3 4)',
    'rgb(var(--r) 0 0)',
    'rgb(from red r g b)',
    'rgb(calc(10) 0 0)',
    'rgb(none, 0, 0)',
    'rgb()',
    'rgb(1 2 3 /)',
  ])('odbija %s', (input) => {
    expect(parseColor(input)).toBeNull();
  });
});

describe('parseColor — hsl() i hwb()', () => {
  it.each([
    ['hsl(120, 100%, 25%)', [0, 127.5, 0]],
    ['hsl(120deg 100% 25%)', [0, 127.5, 0]],
    ['hsl(0.5turn 100% 50%)', [0, 255, 255]],
    ['hsla(240, 100%, 50%, .5)', [0, 0, 255, 0.5]],
    ['hsl(-120 100% 50%)', [0, 0, 255]],
    ['hsl(217 33% 17%)', [29, 40, 57.7]],
    ['hwb(0 0% 0%)', [255, 0, 0]],
    ['hwb(0 50% 50%)', [127.5, 127.5, 127.5]],
    ['hwb(120 20% 20%)', [51, 204, 51]],
  ] as const)('%s', (input, expected) => {
    expectRgb(rgbOf(input), [...expected] as [number, number, number, number?]);
  });

  it('odbija stari hsl bez procenata', () => {
    expect(parseColor('hsl(120, 100, 25)')).toBeNull();
  });
});

describe('parseColor — lab/lch/oklab/oklch/color()', () => {
  it.each([
    ['lab(54.29% 80.8 69.89)', [255, 0, 0]],
    ['lab(50 0 0)', [119, 119, 119]],
    ['lch(54.29% 106.84 40.85)', [255, 0, 0]],
    ['oklab(0.62796 0.22486 0.12585)', [255, 0, 0]],
    ['oklch(62.796% 0.25768 29.2339)', [255, 0, 0]],
    ['oklch(1 0 0)', [255, 255, 255]],
    ['oklch(0.5 0 none / 50%)', [99, 99, 99, 0.5]],
    ['color(srgb 1 0.5 0)', [255, 127.5, 0]],
    ['color(srgb-linear 1 0.214 0)', [255, 128, 0]],
    ['color(xyz-d65 0.95046 1 1.08906)', [255, 255, 255]],
    ['color(xyz-d50 0.96422 1 0.82521)', [255, 255, 255]],
  ] as const)('%s', (input, expected) => {
    expectRgb(rgbOf(input), [...expected] as [number, number, number, number?], 1);
  });

  it('display-p3 crvena je van sRGB gamuta', () => {
    const c = rgbOf('color(display-p3 1 0 0)')!;
    expect(c.r).toBeGreaterThan(1);
    expect(c.g).toBeLessThan(0);
  });

  it.each(['lab(50, 0, 0)', 'color(rec2020 1 0 0)', 'color(srgb 1 0)', 'oklch(0.5 0.1)'])('odbija %s', (s) => {
    expect(parseColor(s)).toBeNull();
  });
});
