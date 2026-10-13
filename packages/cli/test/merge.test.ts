import { describe, expect, it } from 'vitest';
import { detectLang } from '../src/i18n.js';
import { crawlable, mergeScans } from '../src/merge.js';
import type { PageScan, PlainUsage } from '../src/types.js';

const usage = (selector: string, value: string, sheet = 'a.css'): PlainUsage => ({
  source: 'cssom',
  property: 'color',
  value,
  colors: [value],
  varRefs: [],
  conditions: [],
  important: false,
  selector,
  sheet,
});
const weight = (key: string, bg: number, text = 0) => ({ key, bgArea: bg, textArea: text, borderArea: 0, svgArea: 0, interactiveArea: 0, elementCount: 1 });
const entry = (key: string, bg: number, text = 0, variables: string[] = []) => ({
  key,
  area: bg + text,
  share: 0,
  weight: weight(key, bg, text),
  declared: { cssom: 1 },
  variables,
});
const scan = (url: string, palette: PageScan['palette'], usages: PlainUsage[], pairs: PageScan['pairs'] = []): PageScan => ({
  url,
  viewport: 1440,
  usages,
  palette,
  pairs,
  sheets: [],
  links: [],
});

describe('mergeScans', () => {
  it('declarations from the same stylesheet count once, in order of first appearance', () => {
    const m = mergeScans([
      scan('/', [], [usage('body', '#ffffff'), usage('.a', '#111111')]),
      scan('/o-nama', [], [usage('body', '#ffffff'), usage('.quote', '#222222', 'about.css')]),
    ]);
    expect(m.usages.map((u) => u.selector)).toEqual(['body', '.a', '.quote']);
  });

  it('every page has the same weight (area is normalized)', () => {
    const m = mergeScans([
      scan('/dugacka', [entry('#ffffff', 9000), entry('#000000', 0, 1000)], []),
      scan('/kratka', [entry('#eeeeee', 100)], []),
    ]);
    const area = Object.fromEntries(m.palette.map((e) => [e.key, e.area]));
    expect(area['#ffffff']).toBeCloseTo(0.9);
    expect(area['#eeeeee']).toBeCloseTo(1); // the short page isn't "outvoted"
    expect(m.palette[0]!.key).toBe('#eeeeee');
    expect(m.palette.reduce((n, e) => n + e.share, 0)).toBeCloseTo(1);
  });

  it('variables and text/background pairs are merged', () => {
    const pair = (fg: string, bg: string, weight: number, minFontSize: number, hasSmallText: boolean) => ({ fg, bg, weight, minFontSize, hasSmallText });
    const m = mergeScans([
      scan('/', [entry('#2563eb', 10, 0, ['--accent'])], [], [pair('#fff', '#2563eb', 5, 18, false)]),
      scan('/x', [entry('#2563eb', 10, 0, ['--brand'])], [], [pair('#fff', '#2563eb', 5, 14, true)]),
    ]);
    expect(m.palette[0]!.variables).toEqual(['--accent', '--brand']);
    expect(m.pairs).toEqual([{ fg: '#fff', bg: '#2563eb', weight: 2, minFontSize: 14, hasSmallText: true }]);
  });
});

describe('crawlable', () => {
  const origin = 'https://sajt.rs';
  it.each([
    ['https://sajt.rs/o-nama#tim', 'https://sajt.rs/o-nama'],
    ['https://sajt.rs/blog?page=2', 'https://sajt.rs/blog?page=2'],
    ['https://drugi.rs/', null],
    ['https://sajt.rs/cenovnik.pdf', null],
    ['https://sajt.rs/slika.JPG', null],
    ['mailto:info@sajt.rs', null],
    ['nije url', null],
  ])('%s → %s', (href, expected) => {
    expect(crawlable(href, origin)).toBe(expected);
  });
});

describe('detectLang', () => {
  it.each<[string[], Record<string, string>, string]>([
    [['--lang', 'en'], { LANG: 'sr_RS.UTF-8' }, 'en'],
    [['--lang=sr'], {}, 'sr'],
    [[], { CC_LANG: 'sr' }, 'sr'],
    [[], { CC_LANG: '', LANG: 'sr_RS.UTF-8' }, 'sr'],
    [[], { LC_ALL: 'sr_Latn_RS' }, 'sr'],
    [[], { LANG: 'de_DE.UTF-8' }, 'en'],
    [[], {}, 'en'],
  ])('%j %j → %s', (argv, env, expected) => {
    expect(detectLang(argv, env)).toBe(expected);
  });
});
