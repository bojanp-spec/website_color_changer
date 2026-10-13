import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { BUNDLE } from './helpers.js';
import { PRESETS } from '../src/analyze/presets.js';

type CCModule = typeof import('../src/index.js');
type Win = Window & { CC: CCModule; engine: ReturnType<CCModule['createEngine']> };

const PRESET = 'crveno-sivo';

/** Inject the bundle, analyze, apply the preset; return a short report. */
async function applyPreset(page: Page, preset = PRESET) {
  if (!(await page.evaluate(() => 'CC' in window))) await page.addScriptTag({ path: BUNDLE });
  return page.evaluate(async (name) => {
    const w = window as unknown as Win;
    w.engine = w.CC.createEngine(document);
    await w.engine.analyze();
    const r = w.engine.apply(w.CC.PRESETS[name]!);
    return {
      map: Object.fromEntries(r.colorMap.map),
      rules: r.rules,
      patchedElements: r.patchedElements,
      fixes: r.localContrastFixes,
      fallbackPatched: r.fallbackPatched,
      warnings: r.colorMap.warnings,
    };
  }, preset);
}

const computed = (page: Page, selector: string, prop: string) =>
  page.$eval(selector, (el, p) => {
    const CC = (window as unknown as Win).CC;
    return CC.colorKey(getComputedStyle(el).getPropertyValue(p));
  }, prop);

/** Snapshot of the structure and layout of all elements (excluding our layer). */
const layout = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('body *')).map((el) => {
      const r = el.getBoundingClientRect();
      return `${el.localName}.${el.className} ${r.x},${r.y},${r.width},${r.height}`;
    }),
  );

/** Document HTML without <script> tags (the test injects the bundle as a <script>); optionally without `style` attributes too. */
const outerHTML = (page: Page, withoutStyleAttrs = false) =>
  page.evaluate((noStyle) => {
    const clone = document.documentElement.cloneNode(true) as Element;
    clone.querySelectorAll('script').forEach((s) => s.remove());
    if (noStyle) clone.querySelectorAll('[style]').forEach((el) => el.removeAttribute('style'));
    return clone.outerHTML;
  }, withoutStyleAttrs);

test.describe('blue-gray-vars', () => {
  test.beforeEach(({ page }) => page.goto('/blue-gray-vars/'));

  test('applies the palette without changing structure or layout',async ({ page }) => {
    const before = { html: await outerHTML(page), layout: await layout(page) };
    const r = await applyPreset(page);
    expect(await computed(page, 'body', 'background-color')).toBe('#fafafa');
    expect(await computed(page, '.btn-cta', 'background-color')).toBe('#d32f2f');
    expect(await computed(page, 'body', 'color')).toBe(r.map['#1e293b']);
    expect(await computed(page, 'header', 'background-color')).toBe(r.map['#1e3a8a']);
    expect(await outerHTML(page)).toBe(before.html); // DOM untouched (the layer lives in adoptedStyleSheets)
    expect(await layout(page)).toEqual(before.layout);
    expect(r.patchedElements).toBe(0);
  });

  test(':hover and :focus-visible states are mapped',async ({ page }) => {
    const r = await applyPreset(page);
    await page.hover('.btn-cta');
    await expect.poll(() => computed(page, '.btn-cta', 'background-color')).toBe(r.map['#1d4ed8']);
    await page.hover('header a');
    expect(await computed(page, 'header a', 'color')).toBe(r.map['#ffffff'] ?? '#ffffff');
  });

  test("the site's dark mode (prefers-color-scheme) gets a mapped dark variant",async ({ page }) => {
    const r = await applyPreset(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await computed(page, 'body', 'background-color')).toBe(r.map['#0f172a']);
  });

  test('disable() restores the original pixel-identically; toggle()',async ({ page }) => {
    const original = await page.screenshot({ fullPage: true });
    await applyPreset(page);
    await page.waitForTimeout(50);
    expect(await page.screenshot({ fullPage: true })).not.toEqual(original);
    await page.evaluate(() => (window as unknown as Win).engine.disable());
    expect(await page.screenshot({ fullPage: true })).toEqual(original);
    expect(await page.evaluate(() => (window as unknown as Win).engine.toggle())).toBe(true);
    expect(await computed(page, 'body', 'background-color')).toBe('#fafafa');
    expect(await page.evaluate(() => (window as unknown as Win).engine.toggle())).toBe(false);
    expect(await computed(page, 'body', 'background-color')).toBe('#f8fafc');
  });

  test('exportCss produces CSS with the same selectors',async ({ page }) => {
    await applyPreset(page);
    const css = await page.evaluate(() => (window as unknown as Win).engine.exportCss());
    expect(css).toContain(':root {\n  --bg: #fafafa;');
    expect(css).toContain('@media (prefers-color-scheme: dark) {');
    expect(css).not.toContain('!important');
  });
});

test.describe('blue-gray-plain', () => {
  test.beforeEach(({ page }) => page.goto('/blue-gray-plain/'));

  test('@layer, nesting, gradient, @keyframes; url() untouched',async ({ page }) => {
    const r = await applyPreset(page);
    expect(await computed(page, '.panel', 'background-color')).toBe(r.map['#ffffff'] ?? '#ffffff');
    expect(await computed(page, '.panel', 'border-top-color')).toBe(r.map['#cbd5e0']);
    const topbar = await page.$eval('.topbar', (el) => getComputedStyle(el).backgroundImage);
    expect(topbar).toContain('linear-gradient');
    expect(topbar).not.toContain('rgb(30, 58, 95)');
    const cta = await page.$eval('.cta', (el) => getComputedStyle(el).backgroundImage);
    expect(cta).toContain('url("data:image/png;base64,iVBORw0KGgo=")');
    await page.hover('.list li');
    expect(await computed(page, '.list li', 'color')).toBe(r.map['#2b6cb0']);
  });

  test('@media breakpoint is mapped',async ({ page }) => {
    const r = await applyPreset(page);
    await page.setViewportSize({ width: 500, height: 800 });
    expect(await computed(page, '.topbar', 'background-color')).toBe(r.map['#1a365d']);
  });

  test('inline style and SVG/HTML attributes: mapped, then restored exactly',async ({ page }) => {
    const original = await outerHTML(page);
    const r = await applyPreset(page);
    expect(r.patchedElements).toBe(3); // <p style>, <circle fill stroke>, <td bgcolor>
    expect(await computed(page, 'p[style]', 'color')).toBe(r.map['#718096']);
    expect(await page.getAttribute('circle', 'fill')).toBe(r.map['#2c5282']!.toUpperCase());
    expect(await page.getAttribute('td', 'bgcolor')).toBe(r.map['#e2e8f0']!.toUpperCase());
    await page.evaluate(() => (window as unknown as Win).engine.disable());
    expect(await outerHTML(page)).toBe(original);
  });

  test('dynamic content: new elements and new <style> get the palette',async ({ page }) => {
    const r = await applyPreset(page);
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.id = 'dyn';
      p.style.color = '#718096';
      document.body.append(p);
      const style = document.createElement('style');
      style.textContent = '#late { background-color: #3182ce; height: 10px; }';
      document.head.append(style);
      const late = document.createElement('div');
      late.id = 'late';
      document.body.append(late);
    });
    await expect.poll(() => computed(page, '#dyn', 'color')).toBe(r.map['#718096']);
    await expect.poll(() => computed(page, '#late', 'background-color')).toBe(r.map['#3182ce']);
  });
});

test('shadow DOM: the layer is added to the shadow root too',async ({ page }) => {
  await page.goto('/shadow-dom/');
  const r = await applyPreset(page);
  const bg = await page.evaluate(() => {
    const btn = document.querySelector('promo-card')!.shadowRoot!.querySelector('.btn')!;
    return (window as unknown as Win).CC.colorKey(getComputedStyle(btn).backgroundColor);
  });
  expect(bg).toBe(r.map['#1d4ed8']);
  expect(await computed(page, '[data-cc]', 'background-color')).toBe('#ff00ff'); // our UI untouched
});

test('cross-origin without CORS: computed fallback',async ({ page }) => {
  await page.goto('/cross-origin/');
  const r = await applyPreset(page);
  expect(r.fallbackPatched).toBeGreaterThan(0);
  expect(await computed(page, '.remote-cors', 'background-color')).toBe(r.map['#2a4365']);
  expect(await computed(page, '.remote-nocors', 'background-color')).toBe(r.map['#4a5568']);
});

test.describe('drmozgovich.top (snapshot) — main test site', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await page.goto('/drmozgovich/');
    // The site has entrance animations (motion-ready) — measure only once they finish.
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished)));
  });

  /** Contrast of every visible text: after applying, it must not drop below min(AA, original). */
  async function contrastAudit(page: Page, action: () => Promise<unknown>) {
    await page.addScriptTag({ path: BUNDLE });
    const measure = () =>
      page.evaluate(() => {
        const CC = (window as unknown as Win).CC;
        const bgOf = (el: Element | null): string => {
          for (let n = el; n; n = n.parentElement) {
            const c = CC.parseColor(getComputedStyle(n).backgroundColor);
            if (c && c.rgba.a > 0.5) return getComputedStyle(n).backgroundColor;
          }
          return 'white';
        };
        const out: { id: number; ratio: number; large: boolean; text: string }[] = [];
        document.querySelectorAll('body *').forEach((el, id) => {
          const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim());
          if (!own || !(el as HTMLElement).checkVisibility?.({ opacityProperty: true, visibilityProperty: true })) return;
          const cs = getComputedStyle(el);
          const fg = CC.parseColor(cs.color)?.rgba;
          const bg = CC.parseColor(bgOf(el))?.rgba;
          if (!fg || !bg) return;
          const large = CC.isLargeText(parseFloat(cs.fontSize), parseInt(cs.fontWeight, 10));
          out.push({ id, ratio: CC.contrastRatio(fg, bg), large, text: el.textContent!.trim().slice(0, 30) });
        });
        return out;
      });
    const before = await measure();
    await action();
    const after = new Map((await measure()).map((m) => [m.id, m]));
    return before
      .map((b) => ({ ...b, after: after.get(b.id)?.ratio ?? 0 }))
      .filter((b) => b.after < Math.min(b.large ? 3 : 4.5, b.ratio) - 0.05);
  }

  for (const preset of Object.keys(PRESETS)) {
    test(`${preset}: no text has worse contrast than min(AA, original)`, async ({ page }) => {
      const failing = await contrastAudit(page, () => applyPreset(page, preset));
      expect(failing).toEqual([]);
    });
  }

  test('crveno-sivo: CTA button text is fixed locally, main text stays',async ({ page }) => {
    const r = await applyPreset(page);
    // On the site, `.btn-primary { color: var(--accent-contrast) }` is overridden by `a { color: inherit }`,
    // so the variable would have no effect — the engine checks for this and colors just those elements.
    expect(r.fixes).toEqual([
      expect.objectContaining({ fg: '#10233f', bg: '#3e9fd9', via: expect.objectContaining({ kind: 'inline', selector: expect.stringContaining('a.btn.btn-primary') }) }),
    ]);
    expect(r.fixes[0]!.via).toMatchObject({ elements: r.patchedElements });
    expect(await computed(page, 'a.btn-primary.btn-sm', 'color')).toBe(r.fixes[0]!.to);
    expect(await computed(page, 'body', 'color')).toBe('#4b4b4f'); // main text unchanged by the fix
    expect(await computed(page, 'body', 'background-color')).toBe('#fafafa');
  });

  test("structure and layout stay the same; the site's dark mode is mapped",async ({ page }) => {
    const original = await outerHTML(page);
    const before = { html: await outerHTML(page, true), layout: await layout(page) };
    const r = await applyPreset(page);
    // The only DOM change: inline `color` on CTA elements (local contrast fix).
    expect(await outerHTML(page, true)).toBe(before.html);
    expect(r.patchedElements).toBe(r.fixes.reduce((n, f) => n + (f.via.kind === 'inline' ? f.via.elements : 0), 0));
    expect(await layout(page)).toEqual(before.layout);
    await page.evaluate(() => (window as unknown as Win).engine.disable());
    expect(await outerHTML(page)).toBe(original); // restored byte-identically
    await page.evaluate(() => (window as unknown as Win).engine.apply((window as unknown as Win).CC.PRESETS['crveno-sivo']!));
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await computed(page, 'body', 'background-color')).toBe(r.map['#0b1626']);
  });
});
