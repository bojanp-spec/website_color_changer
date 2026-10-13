import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PANEL = fileURLToPath(new URL('../dist/cc-panel.js', import.meta.url));
const BOOKMARKLET = fileURLToPath(new URL('../dist/bookmarklet.txt', import.meta.url));
const PANEL_EN = fileURLToPath(new URL('../dist/cc-panel_en.js', import.meta.url));
const BOOKMARKLET_EN = fileURLToPath(new URL('../dist/bookmarklet_en.txt', import.meta.url));

const openPanel = async (page: Page) => {
  await page.addScriptTag({ path: PANEL });
  await expect(page.locator('cc-panel').getByText('Nova paleta')).toBeVisible();
  return page.locator('cc-panel');
};

const bg = (page: Page, selector: string, prop = 'background-color') =>
  page.$eval(selector, (el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test.beforeEach(async ({ page }) => {
  await page.goto('/blue-gray-vars/');
  await page.evaluate(() => localStorage.clear());
});

test('shows detected colors by role and base colors in the pickers', async ({ page }) => {
  const panel = await openPanel(page);
  await expect(panel.locator('[data-role-group="dominant"] .chip.base')).toHaveAttribute('data-color', '#f8fafc');
  await expect(panel.locator('[data-role-group="secondary"] .chip.base')).toHaveAttribute('data-color', '#1e293b');
  await expect(panel.locator('[data-role-group="accent"] .chip.base')).toHaveAttribute('data-color', '#2563eb');
  await expect(panel.locator('input[type="text"][data-role="accent"]')).toHaveValue('#2563eb');
  // The panel does not change the site until a palette is chosen
  expect(await bg(page, 'body')).toBe('rgb(248, 250, 252)');
});

test('ready-made palette, Original, A/B button and Alt+C', async ({ page }) => {
  const panel = await openPanel(page);
  await panel.locator('[data-preset="crveno-sivo"]').click();
  expect(await bg(page, 'body')).toBe('rgb(250, 250, 250)');
  expect(await bg(page, '.btn-cta')).toBe('rgb(211, 47, 47)');
  await expect(panel.locator('.status')).toContainText('Primenjeno');

  await panel.locator('[data-action="toggle"]').click();
  expect(await bg(page, 'body')).toBe('rgb(248, 250, 252)');
  await page.keyboard.press('Alt+KeyC');
  expect(await bg(page, 'body')).toBe('rgb(250, 250, 250)');

  await panel.locator('[data-preset="original"]').click();
  expect(await bg(page, '.btn-cta')).toBe('rgb(37, 99, 235)');
});

test('custom color: HEX field and color picker, live preview', async ({ page }) => {
  const panel = await openPanel(page);
  await panel.locator('input[type="text"][data-role="accent"]').fill('#00a86b');
  await expect.poll(() => bg(page, '.btn-cta')).toBe('rgb(0, 168, 107)');
  await expect(panel.locator('input[type="color"][data-role="accent"]')).toHaveValue('#00a86b');

  await panel.locator('input[type="text"][data-role="accent"]').fill('nije boja');
  await expect(panel.locator('input[type="text"][data-role="accent"]')).toHaveAttribute('aria-invalid', 'true');
  expect(await bg(page, '.btn-cta')).toBe('rgb(0, 168, 107)'); // invalid input is ignored

  await panel.locator('input[type="color"][data-role="dominant"]').fill('#fff8e7');
  await expect.poll(() => bg(page, 'body')).toBe('rgb(255, 248, 231)');
});

test('manual color role change (header to accent)', async ({ page }) => {
  const panel = await openPanel(page);
  await panel.locator('[data-preset="crveno-sivo"]').click();
  const headerBefore = await bg(page, 'header');
  await panel.locator('.chip[data-color="#1e3a8a"]').click();
  await panel.getByRole('combobox', { name: 'Uloga boje #1e3a8a' }).selectOption('accent');
  await expect(panel.locator('[data-role-group="accent"] .chip[data-color="#1e3a8a"]')).toBeVisible();
  await expect.poll(() => bg(page, 'header')).not.toBe(headerBefore);
  // the override is remembered per domain
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cc:127.0.0.1')!).overrides)).toEqual({ '#1e3a8a': 'accent' });
});

test('role menu works with real clicks: clicking the list does not close the menu; Esc and a second click close it', async ({ page }) => {
  const panel = await openPanel(page);
  const chip = panel.locator('.chip[data-color="#1e3a8a"]');
  await chip.click();
  const select = panel.getByRole('combobox', { name: 'Uloga boje #1e3a8a' });
  // Regression: the menu used to live inside the button (the swatch), so clicking the list replaced it with a new one.
  expect(await select.evaluate((el) => !!el.closest('button'))).toBe(false);
  await select.evaluate((el) => (el.dataset.mark = 'isti'));
  await select.click();
  expect(await select.evaluate((el) => el.dataset.mark)).toBe('isti');
  await page.keyboard.press('Escape'); // closes the native dropdown
  await select.selectOption('accent');
  await expect(panel.locator('[data-role-group="accent"] .chip[data-color="#1e3a8a"]')).toBeVisible();
  await expect(panel.locator('.status')).toContainText('Videćeš razliku kad primeniš novu paletu');

  // a second click on the same color closes the menu
  await panel.locator('.chip[data-color="#64748b"]').click();
  await expect(panel.locator('.menu')).toHaveCount(1);
  await panel.locator('.chip[data-color="#64748b"]').click();
  await expect(panel.locator('.menu')).toHaveCount(0);
  // Esc inside the menu closes it
  await panel.locator('.chip[data-color="#64748b"]').click();
  await panel.getByRole('combobox', { name: 'Uloga boje #64748b' }).press('Escape');
  await expect(panel.locator('.menu')).toHaveCount(0);
});

test('panel is isolated: the site palette does not affect it, the scanner does not see it', async ({ page }) => {
  const panel = await openPanel(page);
  const panelBg = () => panel.locator('.panel').evaluate((el) => getComputedStyle(el).backgroundColor);
  const before = await panelBg();
  await panel.locator('[data-preset="narandzasto-tamno"]').click();
  expect(await panelBg()).toBe(before);
  await expect(panel.locator('.chip[data-color="#ffffff"]')).toHaveCount(1); // only the site's color, not the panel's
});

test('export: copy CSS, download .css, copy link', async ({ page }) => {
  const panel = await openPanel(page);
  await expect(panel.locator('[data-action="copy-css"]')).toBeDisabled();
  await panel.locator('[data-preset="crveno-sivo"]').click();

  await panel.locator('[data-action="copy-css"]').click();
  await expect(panel.locator('[data-action="copy-css"]')).toHaveText('Kopirano ✓');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('--accent: #d32f2f;');

  const download = page.waitForEvent('download');
  await panel.locator('[data-action="download"]').click();
  expect((await download).suggestedFilename()).toBe('127.0.0.1-paleta.css');

  await panel.locator('[data-action="copy-link"]').click();
  await expect(panel.locator('[data-action="copy-link"]')).toHaveText('Link kopiran ✓');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('http://127.0.0.1:4173/blue-gray-vars/#cc=fafafa,4b4b4f,d32f2f');
});

test('a palette link is applied immediately', async ({ page }) => {
  await page.goto('/blue-gray-vars/#cc=fafafa,4b4b4f,d32f2f');
  await openPanel(page);
  expect(await bg(page, '.btn-cta')).toBe('rgb(211, 47, 47)');
});

test('the last palette is remembered per domain (fills the pickers, does not apply itself)', async ({ page }) => {
  const panel = await openPanel(page);
  await panel.locator('[data-preset="zuto-zeleno"]').click();
  await page.reload();
  const again = await openPanel(page);
  await expect(again.locator('input[type="text"][data-role="accent"]')).toHaveValue('#f2b705');
  expect(await bg(page, '.btn-cta')).toBe('rgb(37, 99, 235)');
});

test('closing (×) restores the original and removes the panel; clicking the bookmarklet again hides/shows it', async ({ page }) => {
  const panel = await openPanel(page);
  await panel.locator('[data-preset="crveno-sivo"]').click();
  await page.addScriptTag({ path: PANEL }); // "second click"
  await expect(panel.locator('.panel')).toBeHidden();
  await page.addScriptTag({ path: PANEL });
  await expect(panel.locator('.panel')).toBeVisible();
  await panel.getByRole('button', { name: 'Zatvori' }).click();
  await expect(page.locator('cc-panel')).toHaveCount(0);
  expect(await bg(page, 'body')).toBe('rgb(248, 250, 252)');
});

test('snippet mode: hidden without ?cc=1, shown with ?cc=1', async ({ page }) => {
  const addSnippet = () =>
    page.evaluate((src) => {
      const s = document.createElement('script');
      s.setAttribute('data-cc-snippet', '');
      s.textContent = src;
      document.head.append(s);
    }, readFileSync(PANEL, 'utf8'));

  await addSnippet();
  await page.waitForTimeout(100);
  await expect(page.locator('cc-panel')).toHaveCount(0);

  await page.goto('/blue-gray-vars/?cc=1');
  await addSnippet();
  await expect(page.locator('cc-panel').getByText('Nova paleta')).toBeVisible();
});

test('bookmarklet (all code inside the link) works', async ({ page }) => {
  const url = readFileSync(BOOKMARKLET, 'utf8');
  expect(url.startsWith('javascript:')).toBe(true);
  const code = decodeURIComponent(url.slice('javascript:'.length));
  await page.evaluate(code);
  await expect(page.locator('cc-panel').getByText('Nova paleta')).toBeVisible();
});

test('drmozgovich.top (snapshot): panel detects the palette and applies a preset', async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto('/drmozgovich/');
  const panel = await openPanel(page);
  await expect(panel.locator('[data-role-group="accent"] .chip.base')).toHaveAttribute('data-color', '#3e9fd9');
  await panel.locator('[data-preset="crveno-sivo"]').click();
  expect(await bg(page, 'body')).toBe('rgb(250, 250, 250)');
  expect(await bg(page, 'a.btn-primary.btn-sm', 'color')).toBe('rgb(243, 243, 248)');
});

test.describe('English version (_en)', () => {
  test('panel is in English: headings, palettes, roles and reasons', async ({ page }) => {
    await page.addScriptTag({ path: PANEL_EN });
    const panel = page.locator('cc-panel');
    await expect(panel.getByText('New palette')).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Site colors' })).toHaveCount(2); // panel title + section
    await expect(panel.locator('[data-preset="crveno-sivo"]')).toContainText('Red / gray');
    await expect(panel.locator('[data-preset="ponoc-zlatno"]')).toContainText('Midnight / gold');
    await expect(panel.locator('[data-role-group="dominant"]').locator('xpath=preceding-sibling::div[1]')).toContainText('Dominant (60%)');
    await expect(panel.locator('[data-action="toggle"]')).toContainText('Apply palette');
    await expect(panel.locator('.status')).toHaveText('Pick colors or a ready-made palette.');

    await panel.locator('.chip[data-color="#f8fafc"]').click();
    await expect(panel.locator('.menu')).toContainText('largest background area');
    await expect(panel.locator('.menu .hint')).toContainText('The role decides');
    await panel.getByRole('combobox', { name: 'Role of color #f8fafc' }).press('Escape');

    await panel.locator('[data-preset="tirkiz-okean"]').click();
    await expect(panel.locator('.status')).toContainText('Applied:');
    await expect(panel.locator('[data-action="toggle"]')).toContainText('Show original');
    const download = page.waitForEvent('download');
    await panel.locator('[data-action="download"]').click();
    expect((await download).suggestedFilename()).toBe('127.0.0.1-palette.css');
    await panel.locator('[data-action="copy-css"]').click();
    await expect(panel.locator('[data-action="copy-css"]')).toHaveText('Copied ✓');
    const css = await page.evaluate(() => navigator.clipboard.readText());
    expect(css).toContain("Include AFTER the site's existing styles.");
    expect(css).not.toContain('Dodati POSLE');
  });

  test('bookmarklet_en works and contains no Serbian text', async ({ page }) => {
    const code = decodeURIComponent(readFileSync(BOOKMARKLET_EN, 'utf8').slice('javascript:'.length));
    await page.evaluate(code);
    const panel = page.locator('cc-panel');
    await expect(panel.getByText('Ready-made palettes')).toBeVisible();
    const text = await panel.locator('.panel').innerText();
    expect(text).not.toMatch(/Nova paleta|Gotove palete|Izvoz|Primeni|Boje sajta/);
  });
});
