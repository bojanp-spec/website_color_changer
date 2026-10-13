import type { BrowserContext, Page } from '@playwright/test';
import type { ColorMapResult, LocalContrastFix, Palette } from '@cc/core';
import type { PageScan, PageVerification } from './types.js';

type CCModule = typeof import('@cc/core');
type CCWindow = Window & { CC: CCModule };

export interface LoadOptions {
  viewport: number;
  /** Scroll to the bottom (lazy-loaded content). */
  scroll: boolean;
  /** Extra wait after load (ms). */
  wait: number;
}

export async function openPage(context: BrowserContext, url: string, opts: LoadOptions): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: opts.viewport, height: opts.viewport < 768 ? 844 : 900 });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  if (opts.scroll) {
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * 0.8) {
        scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 100));
      }
      scrollTo(0, 0);
    });
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  // Site entrance animations: measure only once they finish (infinite ones are skipped).
  await page
    .evaluate(() =>
      Promise.race([
        Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 3000)),
      ]),
    )
    .catch(() => {});
  if (opts.wait) await page.waitForTimeout(opts.wait);
  return page;
}

export async function injectCore(page: Page, bundle: string) {
  if (!(await page.evaluate(() => 'CC' in window))) await page.addScriptTag({ path: bundle });
}

/** Scans the page; returns only serializable data. */
export async function scanPage(page: Page, bundle: string, viewport: number): Promise<PageScan> {
  await injectCore(page, bundle);
  return page.evaluate(async (vp) => {
    const CC = (window as unknown as CCWindow).CC;
    const r = await CC.scanDocument(document);
    const links = Array.from(document.querySelectorAll('a[href]'), (a) => (a as HTMLAnchorElement).href);
    return {
      url: location.href,
      viewport: vp,
      usages: r.usages.map(({ element, ...u }) => (element ? { ...u, inline: true } : u)),
      palette: r.palette,
      pairs: r.pairs,
      sheets: r.sheets,
      links,
    };
  }, viewport);
}

/** Applies the shared map to the page and returns local contrast fixes that require the DOM. */
export async function localFixes(page: Page, bundle: string, palette: Palette, map: ColorMapResult): Promise<LocalContrastFix[]> {
  await injectCore(page, bundle);
  const plain = { entries: map.entries, warnings: map.warnings, failures: map.failures, map: [...map.map] };
  return page.evaluate(
    async ({ palette, plain }) => {
      const CC = (window as unknown as CCWindow).CC;
      const engine = CC.createEngine(document, { observe: false, suppressTransitions: false });
      await engine.analyze();
      const r = engine.apply(palette, { colorMap: { ...plain, map: new Map(plain.map) } });
      engine.destroy();
      return r.localContrastFixes;
    },
    { palette, plain },
  );
}

/**
 * Verifies the exported CSS without the engine: the CSS is added as the last stylesheet (as in production),
 * then the contrast of every visible text is measured and elements left in an old color are found.
 */
export async function verifyPage(
  page: Page,
  bundle: string,
  css: string,
  map: ReadonlyMap<string, string>,
  viewport: number,
  screenshot?: string,
): Promise<PageVerification> {
  await injectCore(page, bundle);
  const measure = () =>
    page.evaluate(() => {
      const CC = (window as unknown as CCWindow).CC;
      const bgOf = (el: Element | null): string => {
        for (let n = el; n; n = n.parentElement) {
          const c = CC.parseColor(getComputedStyle(n).backgroundColor);
          if (c && c.rgba.a > 0.5) return getComputedStyle(n).backgroundColor;
        }
        return 'white';
      };
      const out: { id: number; ratio: number; large: boolean; text: string }[] = [];
      document.querySelectorAll('body *').forEach((el, id) => {
        if (el.closest('[data-cc]')) return;
        const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim());
        if (!own || !(el as HTMLElement).checkVisibility?.({ opacityProperty: true, visibilityProperty: true })) return;
        const cs = getComputedStyle(el);
        const fg = CC.parseColor(cs.color)?.rgba;
        const bg = CC.parseColor(bgOf(el))?.rgba;
        if (!fg || !bg) return;
        out.push({
          id,
          ratio: CC.contrastRatio(fg, bg),
          large: CC.isLargeText(parseFloat(cs.fontSize), parseInt(cs.fontWeight, 10)),
          text: el.textContent!.trim().replace(/\s+/g, ' ').slice(0, 40),
        });
      });
      return out;
    });

  // Site transitions (e.g. `transition: background .2s` on buttons) would catch the measurement mid-
  // animation; in production the CSS applies from first load, so transitions are disabled during verification.
  await page.evaluate(() => {
    const still = new CSSStyleSheet();
    still.replaceSync('*, *::before, *::after { transition: none !important; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, still];
  });
  const before = await measure();
  const uncovered = await page.evaluate(
    ({ css, entries }) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      const CC = (window as unknown as CCWindow).CC;
      const map = new Map(entries);
      const targets = new Set(entries.map(([, to]) => to));
      const props = ['color', 'background-color', 'border-top-color', 'fill', 'stroke'];
      const out: { selector: string; property: string; color: string }[] = [];
      for (const el of Array.from(document.querySelectorAll('body, body *'))) {
        if (el.closest('[data-cc]') || !(el as HTMLElement).checkVisibility?.()) continue;
        const cs = getComputedStyle(el);
        for (const prop of props) {
          if (prop === 'border-top-color' && parseFloat(cs.borderTopWidth) === 0) continue;
          const key = CC.colorKey(cs.getPropertyValue(prop));
          if (!key || targets.has(key)) continue;
          const to = map.get(key);
          if (to && to !== key) {
            const cls = Array.from(el.classList).slice(0, 3).map((c) => `.${c}`).join('');
            out.push({ selector: `${el.localName}${el.id ? `#${el.id}` : ''}${cls}`, property: prop, color: key });
          }
        }
      }
      return out.slice(0, 50);
    },
    { css, entries: [...map] },
  );
  const after = new Map((await measure()).map((m) => [m.id, m]));
  const contrastRegressions = before
    .map((b) => ({ text: b.text, before: b.ratio, after: after.get(b.id)?.ratio ?? 0, large: b.large }))
    .filter((b) => b.after < Math.min(b.large ? 3 : 4.5, b.before) - 0.05)
    .map(({ text, before, after }) => ({ text, before: round(before), after: round(after) }));

  if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });
  return { url: page.url(), viewport, contrastRegressions, uncovered, ...(screenshot ? { screenshot } : {}) };
}

const round = (n: number) => Math.round(n * 100) / 100;
