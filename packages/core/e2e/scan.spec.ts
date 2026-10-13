import { expect, test } from '@playwright/test';
import { BUNDLE, find, paletteEntry, scan } from './helpers.js';

test.describe('blue-gray-vars (CSS varijable)', () => {
  test.beforeEach(({ page }) => page.goto('/blue-gray-vars/'));

  test('pronalazi definicije varijabli, i u @media za dark mode', async ({ page }) => {
    const r = await scan(page);
    const vars = find(r, (u) => u.source === 'variable');
    expect(vars).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: '--primary', colors: ['#1e3a8a'], selector: ':root', conditions: [] }),
        expect.objectContaining({ property: '--accent', colors: ['#2563eb'] }),
        expect.objectContaining({
          property: '--bg',
          colors: ['#0f172a'],
          conditions: ['@media (prefers-color-scheme: dark)'],
        }),
      ]),
    );
    expect(paletteEntry(r, '#2563eb')?.variables).toEqual(['--accent']);
  });

  test('beleži reference na varijable i :hover/:focus stanja', async ({ page }) => {
    const r = await scan(page);
    // `background: var(--bg)` — shorthand sa varijablom ostaje shorthand
    expect(find(r, (u) => u.selector === 'body' && u.property === 'background')[0]).toMatchObject({
      value: 'var(--bg)',
      colors: [],
      varRefs: ['--bg'],
    });
    expect(find(r, (u) => u.selector === '.card' && u.property === 'border')[0]).toMatchObject({
      value: '1px solid var(--border)',
      varRefs: ['--border'],
    });
    expect(find(r, (u) => u.selector === '.btn-cta:hover')[0]).toMatchObject({ varRefs: ['--accent-hover'] });
    expect(find(r, (u) => u.selector === 'header a:hover')[0]).toMatchObject({ colors: ['#ffffff'] });
    expect(find(r, (u) => u.selector === '.btn-cta:focus-visible')[0]).toMatchObject({
      property: 'outline-color',
      colors: ['#2563eb66'],
    });
    // deklarisana, ali trenutno nevidljiva boja (hover) je u paleti sa area = 0
    expect(paletteEntry(r, '#1d4ed8')).toMatchObject({ area: 0 });
  });

  test('ponder površine: pozadina dominira, akcent je mali i interaktivan', async ({ page }) => {
    const r = await scan(page);
    expect(r.palette[0]?.key).toBe('#f8fafc');
    expect(r.palette[0]!.share).toBeGreaterThan(0.4);

    const accent = paletteEntry(r, '#2563eb')!;
    expect(accent.share).toBeGreaterThan(0);
    expect(accent.share).toBeLessThan(0.05);
    expect(accent.weight.interactiveArea).toBeCloseTo(accent.area, 0);

    expect(paletteEntry(r, '#1e3a8a')!.weight.bgArea).toBeGreaterThan(0); // header
    expect(paletteEntry(r, '#64748b')!.weight.textArea).toBeGreaterThan(0); // prigušen tekst
    expect(paletteEntry(r, '#e2e8f0')!.weight.borderArea).toBeGreaterThan(0); // ivice kartica

    // Kartice pokrivaju deo dominantne pozadine — ta površina se oduzima.
    const card = paletteEntry(r, '#ffffff')!;
    expect(card.weight.bgArea).toBeGreaterThan(0);
  });

  test('beleži parove tekst/pozadina za kontrast', async ({ page }) => {
    const r = await scan(page);
    expect(r.pairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fg: '#ffffff', bg: '#2563eb' }), // CTA
        expect.objectContaining({ fg: '#64748b', bg: '#ffffff' }), // opis u kartici
        expect.objectContaining({ fg: '#1e293b', bg: '#f8fafc' }), // glavni tekst
      ]),
    );
  });
});

test.describe('blue-gray-plain (hardkodovane boje)', () => {
  test.beforeEach(({ page }) => page.goto('/blue-gray-plain/'));

  test('@import, gradijent, @layer, @supports, nesting, @keyframes', async ({ page }) => {
    const r = await scan(page);
    expect(r.sheets.find((s) => s.href?.endsWith('/base.css'))).toMatchObject({ owner: 'import', status: 'ok' });
    expect(find(r, (u) => u.selector === '.topbar' && u.property === 'background-image')[0]).toMatchObject({
      colors: ['#1e3a5f', '#2c5282'],
      conditions: [],
    });
    expect(find(r, (u) => u.selector === '.panel' && u.property === 'background-color')[0]).toMatchObject({
      conditions: ['@layer components'],
    });
    expect(find(r, (u) => u.selector === '.topbar' && u.conditions[0] === '@media (max-width: 600px)')[0]).toMatchObject({
      colors: ['#1a365d'],
    });
    expect(find(r, (u) => u.nesting?.[0] === '.list')[0]).toMatchObject({ selector: '& li:hover', colors: ['#2b6cb0'] });
    expect(find(r, (u) => u.selector === '@keyframes pulse 0%')[0]).toMatchObject({ colors: ['#3182ce'] });
  });

  test('shorthand sa url(): samo boja je boja', async ({ page }) => {
    const r = await scan(page);
    const cta = find(r, (u) => u.selector === '.cta');
    expect(cta.find((u) => u.property === 'background-color')).toMatchObject({ value: 'rgb(49, 130, 206)', colors: ['#3182ce'] });
    expect(cta.find((u) => u.property === 'background-image')).toBeUndefined(); // samo url(), bez boje
  });

  test('inline stilovi, SVG atributi i zastareli bgcolor', async ({ page }) => {
    const r = await scan(page);
    expect(find(r, (u) => u.source === 'inline')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'color', colors: ['#718096'], element: 'p' }),
        expect.objectContaining({ property: 'background-color', colors: ['#f7fafc'], element: 'p' }),
      ]),
    );
    expect(find(r, (u) => u.source === 'svg-attr').map((u) => [u.property, u.colors[0]])).toEqual([
      ['fill', '#2c5282'],
      ['stroke', '#90cdf4'],
    ]);
    expect(find(r, (u) => u.source === 'html-attr')).toEqual([
      expect.objectContaining({ property: 'bgcolor', colors: ['#e2e8f0'], element: 'td' }),
    ]);
    expect(paletteEntry(r, '#2c5282')!.weight.svgArea).toBeGreaterThan(0);
  });

  test('platno uzima pozadinu <html>, providan tekst čuva alfu, submit dugme je tekst', async ({ page }) => {
    const r = await scan(page);
    expect(paletteEntry(r, '#eef2f6')!.weight.bgArea).toBeGreaterThan(0);
    expect(paletteEntry(r, '#eef2f6')!.weight.implicit).toBeUndefined();
    expect(paletteEntry(r, '#2d3748b3')!.weight.textArea).toBeGreaterThan(0);
    expect(r.pairs).toEqual(expect.arrayContaining([expect.objectContaining({ fg: '#ffffff', bg: '#3182ce' })]));
  });

  test('skeniranje ne menja stranicu', async ({ page }) => {
    const before = await page.evaluate(() => document.documentElement.outerHTML);
    await page.evaluate(() => {
      (window as unknown as { __mutations: number }).__mutations = 0;
      new MutationObserver((m) => ((window as unknown as { __mutations: number }).__mutations += m.length)).observe(
        document,
        { subtree: true, childList: true, attributes: true, characterData: true },
      );
    });
    await page.addScriptTag({ path: BUNDLE });
    const after = await page.evaluate(async () => {
      await (window as unknown as { CC: typeof import('../src/index.js') }).CC.scanDocument(document);
      await new Promise((r) => setTimeout(r, 50));
      const mutations = (window as unknown as { __mutations: number }).__mutations;
      document.querySelector('head > script:last-of-type')?.remove(); // bundle koji je ubacio test
      return { html: document.documentElement.outerHTML, mutations };
    });
    // jedina mutacija je <script> tag koji je ubacio test
    expect(after.mutations).toBe(1);
    expect(after.html).toBe(before);
  });
});

test.describe('cross-origin stylesheet-ovi', () => {
  test.beforeEach(({ page }) => page.goto('/cross-origin/'));

  test('CORS: ponovo preuzima; bez CORS-a: blokiran, ali površina se ipak meri', async ({ page }) => {
    const r = await scan(page);
    expect(r.sheets.find((s) => s.href?.includes('/cors/'))).toMatchObject({ status: 'refetched' });
    expect(r.sheets.find((s) => s.href?.includes('/nocors/'))).toMatchObject({ status: 'blocked' });
    expect(find(r, (u) => u.selector === '.remote-cors')[0]).toMatchObject({ colors: ['#2a4365'] });
    expect(find(r, (u) => u.selector === '.remote-nocors')).toEqual([]);
    expect(paletteEntry(r, '#4a5568')!.weight.bgArea).toBeGreaterThan(0); // iz computed stila
  });

  test('fetchCss: false isključuje ponovno preuzimanje', async ({ page }) => {
    const r = await scan(page, { fetchCss: false });
    expect(r.sheets.find((s) => s.href?.includes('/cors/'))).toMatchObject({ status: 'blocked' });
  });
});

test.describe('shadow DOM i naš sopstveni UI', () => {
  test.beforeEach(({ page }) => page.goto('/shadow-dom/'));

  test('skenira <style> i adoptedStyleSheets u otvorenim shadow root-ovima', async ({ page }) => {
    const r = await scan(page);
    expect(find(r, (u) => u.selector === '.box')[0]).toMatchObject({ colors: ['#334155'], sheet: 'promo-card#0>style#0' });
    expect(find(r, (u) => u.selector === '.btn')[0]).toMatchObject({ colors: ['#1d4ed8'], sheet: 'promo-card#0>adopted#0' });
    expect(paletteEntry(r, '#334155')!.weight.bgArea).toBeGreaterThan(0);
    expect(paletteEntry(r, '#1d4ed8')!.weight.interactiveArea).toBeGreaterThan(0);
    expect(r.pairs).toEqual(expect.arrayContaining([expect.objectContaining({ fg: '#e2e8f0', bg: '#334155' })]));
  });

  test('ignoriše elemente sa data-cc', async ({ page }) => {
    const r = await scan(page);
    expect(paletteEntry(r, '#ff00ff')).toBeUndefined();
  });
});

test('printPalette ispisuje paletu u konzolu', async ({ page }) => {
  await page.goto('/blue-gray-vars/');
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.addScriptTag({ path: BUNDLE });
  await page.evaluate(async () => {
    const CC = (window as unknown as { CC: typeof import('../src/index.js') }).CC;
    CC.printPalette(await CC.scanDocument(document));
  });
  expect(logs.some((l) => l.includes('🎨'))).toBe(true);
  expect(logs.some((l) => l.includes('#2563eb'))).toBe(true);
});
