import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postcss from 'postcss';
import scss from 'postcss-scss';
import { describe, expect, it } from 'vitest';
import ccRemap, { canHoldColor } from '../src/index.js';

const MAP = { '#1e3a8a': '#c62828', '#ffffff': '#fffdf5', '#3182ce': '#d32f2f' };
const run = (css: string, opts: Partial<Parameters<typeof ccRemap>[0]> = {}, syntax?: postcss.Syntax) =>
  postcss([ccRemap({ map: MAP, lang: 'sr', ...opts })]).process(css, { from: undefined, ...(syntax ? { syntax } : {}) });

describe('postcss-cc-remap', () => {
  it('changes colors and keeps the original notation', async () => {
    const out = await run('.a { color: #1E3A8A; background: rgb(49, 130, 206) url("x#1e3a8a.png") no-repeat; border: 1px solid white; }');
    expect(out.css).toBe('.a { color: #C62828; background: rgb(211, 47, 47) url("x#1e3a8a.png") no-repeat; border: 1px solid #fffdf5; }');
  });

  it('format: hex', async () => {
    expect((await run('.a { color: rgb(30 58 138) }', { format: 'hex' })).css).toBe('.a { color: #c62828 }');
  });

  it('CSS variables, gradients, shadows, !important', async () => {
    const out = await run(':root { --brand: #1e3a8a; } .b { background-image: linear-gradient(#1e3a8a, transparent); box-shadow: 0 0 2px #1e3a8a !important; }');
    expect(out.css).toBe(':root { --brand: #c62828; } .b { background-image: linear-gradient(#c62828, transparent); box-shadow: 0 0 2px #c62828 !important; }');
  });

  it('leaves non-color properties, strings and selectors alone', async () => {
    const css = '.white, #ffffff { font-family: White, sans-serif; content: "#1e3a8a"; grid-area: white; }';
    expect((await run(css)).css).toBe(css);
  });

  it('colors not in the map stay the same', async () => {
    const css = '.c { color: #123456; background: transparent; outline-color: currentColor; }';
    expect((await run(css)).css).toBe(css);
  });

  it('SCSS: $variables, nested rules and functions', async () => {
    const out = await run('$brand: #1e3a8a;\n.btn { background: darken(#3182ce, 10%); &:hover { color: $brand; } }', {}, scss);
    expect(out.css).toBe('$brand: #c62828;\n.btn { background: darken(#d32f2f, 10%); &:hover { color: $brand; } }');
  });

  it('map from the JSON file produced by cc-export --map; reports the number of changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-remap-'));
    const file = join(dir, 'paleta.map.json');
    writeFileSync(file, JSON.stringify({ palette: { dominant: '#fafafa', secondary: '#4b4b4f', accent: '#d32f2f' }, map: MAP }));
    const out = await run('.a { color: #1e3a8a } .b { color: #ffffff }', { map: file });
    expect(out.css).toBe('.a { color: #c62828 } .b { color: #fffdf5 }');
    expect(out.messages).toContainEqual(expect.objectContaining({ type: 'cc-remap', changed: 2 }));
  });

  it('an invalid map and a missing option give a clear error', () => {
    expect(() => ccRemap({ map: { '#xyz': '#fff' }, lang: 'sr' })).toThrow(/nevalidna boja/);
    expect(() => ccRemap({ map: { '#xyz': '#fff' }, lang: 'en' })).toThrow(/invalid color in the map/);
    expect(() => ccRemap({ lang: 'en' } as never)).toThrow(/is required/);
  });

  it('canHoldColor', () => {
    expect(['color', 'background', 'border-left', '--x', '$x', 'fill', 'box-shadow'].every(canHoldColor)).toBe(true);
    expect(['font-family', 'content', 'grid-area', 'animation-name', 'color-scheme'].some(canHoldColor)).toBe(false);
  });
});

describe('local contrast fixes from the cc-export map', () => {
  const exported = { palette: {}, map: MAP, localRules: { 'a.btn.btn-primary': '#f3f3f8' } };

  it("localRules: 'append' adds the rules at the end of the file", async () => {
    const out = await postcss([ccRemap({ map: exported as never, localRules: 'append', lang: 'sr' })]).process('.a { color: #1e3a8a }', { from: undefined });
    expect(out.css).toBe('.a { color: #c62828 }\n\n/* cc-export: lokalna korekcija kontrasta */\n\na.btn.btn-primary { color: #f3f3f8 }');
    expect(out.warnings()).toEqual([]);
  });

  it('without the option: a warning, no rules added to the file', async () => {
    const out = await postcss([ccRemap({ map: exported as never, lang: 'sr' })]).process('.a { color: #1e3a8a }', { from: undefined });
    expect(out.css).toBe('.a { color: #c62828 }');
    expect(out.warnings()[0]?.text).toContain('lokalnih korekcija');
  });
});

describe('English messages', () => {
  it('comment and warning in English', async () => {
    const exported = { palette: {}, map: MAP, localRules: { 'a.btn': '#ffffff' } };
    const appended = await postcss([ccRemap({ map: exported as never, localRules: 'append', lang: 'en' })]).process('.a{}', { from: undefined });
    expect(appended.css).toContain('/* cc-export: local contrast fix */');
    const warned = await postcss([ccRemap({ map: exported as never, lang: 'en' })]).process('.a{}', { from: undefined });
    expect(warned.warnings()[0]?.text).toContain('local contrast fixes');
  });
});
