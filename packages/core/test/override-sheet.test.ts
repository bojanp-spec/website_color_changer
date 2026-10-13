import { describe, expect, it } from 'vitest';
import { buildOverrideCss, createColorMapper } from '../src/index.js';
import type { Usage } from '../src/index.js';

const mapper = createColorMapper(
  new Map([
    ['#1e3a8a', '#c62828'],
    ['#ffffff', '#ffffff'],
    ['#3182ce', '#d32f2f'],
  ]),
);

const u = (partial: Partial<Usage>): Usage => ({
  source: 'cssom',
  property: 'color',
  value: '',
  colors: [],
  varRefs: [],
  conditions: [],
  important: false,
  selector: '.x',
  ...partial,
});

describe('createColorMapper', () => {
  it('mapira poznate boje, ostale ostavlja', () => {
    expect(mapper.mapKey('#1e3a8a')).toBe('#c62828');
    expect(mapper.mapKey('#ffffff')).toBeUndefined(); // identitet = bez promene
    expect(mapper.mapKey('#00ff00')).toBeUndefined();
  });

  it('praktično ista boja (zaokruživanje) mapira se kao poznata', () => {
    expect(mapper.mapKey('#1e3a8b')).toBe('#c62828');
  });

  it('mapValue čuva format i ostatak vrednosti', () => {
    expect(mapper.mapValue('1px solid rgb(30, 58, 138)')).toBe('1px solid rgb(198, 40, 40)');
    expect(mapper.mapValue('#3182CE url(a.png) no-repeat')).toBe('#D32F2F url(a.png) no-repeat');
    expect(mapper.mapValue('rgba(30, 58, 138, 0.5)')).toBe('rgba(30, 58, 138, 0.5)'); // druga alfa = druga boja
  });
});

describe('buildOverrideCss', () => {
  it('isti selektor, isti omotači, ista važnost — samo boje', () => {
    const css = buildOverrideCss(
      [
        u({ selector: '.btn', property: 'background-color', value: 'rgb(49, 130, 206)', conditions: ['@layer components'] }),
        u({ selector: '.btn', property: 'color', value: 'rgb(255, 255, 255)', conditions: ['@layer components'] }),
        u({ selector: '.btn:hover', property: 'border-top-color', value: 'rgb(30, 58, 138)', important: true, conditions: ['@layer components', '@media (hover: hover)'] }),
      ],
      mapper,
    ).get('')!;
    expect(css).toBe(
      [
        '@layer components {\n.btn {\n  background-color: rgb(211, 47, 47);\n}\n}',
        '@layer components {\n@media (hover: hover) {\n.btn:hover {\n  border-top-color: rgb(198, 40, 40) !important;\n}\n}\n}',
      ].join('\n'),
    );
  });

  it('nesting i varijable; reference na varijable se ne ponavljaju', () => {
    const css = buildOverrideCss(
      [
        u({ source: 'variable', selector: ':root', property: '--brand', value: '#1e3a8a' }),
        u({ selector: 'body', property: 'background', value: 'var(--brand)', varRefs: ['--brand'] }),
        u({ selector: '& li:hover', nesting: ['.list'], value: 'rgb(30, 58, 138)' }),
      ],
      mapper,
    ).get('')!;
    expect(css).toBe(':root {\n  --brand: #c62828;\n}\n.list {\n& li:hover {\n  color: rgb(198, 40, 40);\n}\n}');
  });

  it('varOverrides važi samo van alternativne šeme', () => {
    const usages = [
      u({ source: 'variable', selector: ':root', property: '--on-accent', value: '#1e3a8a' }),
      u({ source: 'variable', selector: ':root', property: '--on-accent', value: '#1e3a8a', conditions: ['@media (prefers-color-scheme: dark)'] }),
    ];
    const css = buildOverrideCss(usages, mapper, {
      varOverrides: new Map([['--on-accent', '#ffffff']]),
      isAlt: (x) => x.conditions.length > 0,
    }).get('')!;
    expect(css).toContain(':root {\n  --on-accent: #ffffff;\n}');
    expect(css).toContain('@media (prefers-color-scheme: dark) {\n:root {\n  --on-accent: #c62828;');
  });

  it('@keyframes se zamenjuje u celini, jednom', () => {
    const ruleText = '@keyframes pulse { 0% { background-color: rgb(49, 130, 206); opacity: 0; } 100% { opacity: 1; } }';
    const css = buildOverrideCss(
      [u({ selector: '@keyframes pulse 0%', property: 'background-color', value: 'rgb(49, 130, 206)', ruleText }), u({ selector: '@keyframes pulse 100%', ruleText, value: 'x' })],
      mapper,
    ).get('')!;
    expect(css).toBe('@keyframes pulse { 0% { background-color: rgb(211, 47, 47); opacity: 0; } 100% { opacity: 1; } }');
  });

  it('shadow root-ovi dobijaju sopstveni CSS; inline upotrebe se preskaču', () => {
    const out = buildOverrideCss(
      [
        u({ scope: 'promo-card#0>', selector: '.box', property: 'background-color', value: '#1e3a8a' }),
        (({ selector: _omit, ...inline }) => inline)(u({ source: 'inline', value: '#1e3a8a' })),
      ],
      mapper,
    );
    expect([...out.keys()]).toEqual(['promo-card#0>']);
  });
});
