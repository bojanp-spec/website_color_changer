import { describe, expect, it } from 'vitest';
import { findColors, hasColor, replaceColors } from '../src/index.js';

const RED = (_: unknown, text: string) => `<${text}>`;

describe('findColors', () => {
  it('nalazi boje u shorthand-u i preskače url()', () => {
    const v = "url(a#fff.png) #fff no-repeat url('x(#000).svg')";
    expect(findColors(v).map((m) => m.text)).toEqual(['#fff']);
  });

  it('gradijenti, senke, var() fallback', () => {
    const v =
      'linear-gradient(to right, rgba(30, 58, 138, .8) 0%, #64748B 100%), 0 1px 2px hsl(0 0% 0% / .1), var(--brand, steelblue)';
    expect(findColors(v).map((m) => m.text)).toEqual([
      'rgba(30, 58, 138, .8)',
      '#64748B',
      'hsl(0 0% 0% / .1)',
      'steelblue',
    ]);
  });

  it('ne zamenjuje imena varijabli, jedinice i ključne reči', () => {
    expect(findColors('var(--red) 1px solid 2em red-ish blue')).toMatchObject([{ text: 'blue' }]);
    expect(findColors('1e3px 10red .5tan')).toEqual([]);
    expect(findColors('"red" \'#fff\'')).toEqual([]);
  });

  it('transparent/currentColor i neizračunljive boje vraća sa color: null', () => {
    const m = findColors('transparent currentColor rgb(var(--r) 0 0)');
    expect(m.map((x) => [x.text, x.color])).toEqual([
      ['transparent', null],
      ['currentColor', null],
      ['rgb(var(--r) 0 0)', null],
    ]);
  });

  it('pozicije odgovaraju originalnom stringu', () => {
    const v = 'border: 1px solid #abc';
    const [m] = findColors(v);
    expect(v.slice(m!.start, m!.end)).toBe('#abc');
  });
});

describe('replaceColors', () => {
  it('menja samo boje, ostatak je bajt-identičan', () => {
    const v = "url(a#fff.png) #fff no-repeat 10px/20px, linear-gradient(red,  Blue 50%)";
    expect(replaceColors(v, RED)).toBe("url(a#fff.png) <#fff> no-repeat 10px/20px, linear-gradient(<red>,  <Blue> 50%)");
  });

  it('ne dira transparent, currentColor ni var()', () => {
    const v = 'transparent currentcolor var(--x) rgb(var(--r) 0 0)';
    expect(replaceColors(v, RED)).toBe(v);
  });

  it('null iz callback-a ostavlja boju', () => {
    expect(replaceColors('#000 #fff', (c) => (c.rgba.r === 1 ? 'W' : null))).toBe('#000 W');
  });

  it('vraća isti string kad nema boja', () => {
    const v = '0 0 0 1px';
    expect(replaceColors(v, RED)).toBe(v);
  });

  it('box-shadow sa više slojeva', () => {
    expect(replaceColors('0 0 0 3px rgba(59,130,246,.5), inset 0 1px #0001', RED)).toBe(
      '0 0 0 3px <rgba(59,130,246,.5)>, inset 0 1px <#0001>',
    );
  });
});

describe('hasColor', () => {
  it.each([
    ['#fff', true],
    ['1px solid transparent', false],
    ['var(--x)', false],
    ['var(--x, #000)', true],
    ['none', false],
  ])('%s → %s', (v, expected) => {
    expect(hasColor(v)).toBe(expected);
  });
});
