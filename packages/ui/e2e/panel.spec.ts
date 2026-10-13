import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PANEL = fileURLToPath(new URL('../dist/cc-panel.js', import.meta.url));
const BOOKMARKLET = fileURLToPath(new URL('../dist/bookmarklet.txt', import.meta.url));

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

test('prikazuje detektovane boje po ulogama i bazne boje u izbornicima', async ({ page }) => {
  const panel = await openPanel(page);
  await expect(panel.locator('[data-role-group="dominant"] .chip.base')).toHaveAttribute('data-color', '#f8fafc');
  await expect(panel.locator('[data-role-group="secondary"] .chip.base')).toHaveAttribute('data-color', '#1e293b');
  await expect(panel.locator('[data-role-group="accent"] .chip.base')).toHaveAttribute('data-color', '#2563eb');
  await expect(panel.locator('input[type="text"][data-role="accent"]')).toHaveValue('#2563eb');
  // Panel ne menja sajt dok se ne izabere paleta
  expect(await bg(page, 'body')).toBe('rgb(248, 250, 252)');
});

test('gotova paleta, Original, A/B dugme i Alt+C', async ({ page }) => {
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

test('sopstvena boja: HEX polje i color picker, živi pregled', async ({ page }) => {
  const panel = await openPanel(page);
  await panel.locator('input[type="text"][data-role="accent"]').fill('#00a86b');
  await expect.poll(() => bg(page, '.btn-cta')).toBe('rgb(0, 168, 107)');
  await expect(panel.locator('input[type="color"][data-role="accent"]')).toHaveValue('#00a86b');

  await panel.locator('input[type="text"][data-role="accent"]').fill('nije boja');
  await expect(panel.locator('input[type="text"][data-role="accent"]')).toHaveAttribute('aria-invalid', 'true');
  expect(await bg(page, '.btn-cta')).toBe('rgb(0, 168, 107)'); // nevalidan unos se ignoriše

  await panel.locator('input[type="color"][data-role="dominant"]').fill('#fff8e7');
  await expect.poll(() => bg(page, 'body')).toBe('rgb(255, 248, 231)');
});

test('ručna promena uloge boje (header u akcenat)', async ({ page }) => {
  const panel = await openPanel(page);
  await panel.locator('[data-preset="crveno-sivo"]').click();
  const headerBefore = await bg(page, 'header');
  await panel.locator('.chip[data-color="#1e3a8a"]').click();
  await panel.getByRole('combobox', { name: 'Uloga boje #1e3a8a' }).selectOption('accent');
  await expect(panel.locator('[data-role-group="accent"] .chip[data-color="#1e3a8a"]')).toBeVisible();
  await expect.poll(() => bg(page, 'header')).not.toBe(headerBefore);
  // korekcija se pamti za domen
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cc:127.0.0.1')!).overrides)).toEqual({ '#1e3a8a': 'accent' });
});

test('panel je izolovan: paleta sajta ga ne menja, skener ga ne vidi', async ({ page }) => {
  const panel = await openPanel(page);
  const panelBg = () => panel.locator('.panel').evaluate((el) => getComputedStyle(el).backgroundColor);
  const before = await panelBg();
  await panel.locator('[data-preset="narandzasto-tamno"]').click();
  expect(await panelBg()).toBe(before);
  await expect(panel.locator('.chip[data-color="#ffffff"]')).toHaveCount(1); // samo boja sajta, ne panela
});

test('izvoz: kopiraj CSS, preuzmi .css, kopiraj link', async ({ page }) => {
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

test('link sa paletom se primenjuje odmah', async ({ page }) => {
  await page.goto('/blue-gray-vars/#cc=fafafa,4b4b4f,d32f2f');
  await openPanel(page);
  expect(await bg(page, '.btn-cta')).toBe('rgb(211, 47, 47)');
});

test('poslednja paleta se pamti po domenu (popuni izbornike, ne primenjuje sama)', async ({ page }) => {
  const panel = await openPanel(page);
  await panel.locator('[data-preset="zuto-zeleno"]').click();
  await page.reload();
  const again = await openPanel(page);
  await expect(again.locator('input[type="text"][data-role="accent"]')).toHaveValue('#f2b705');
  expect(await bg(page, '.btn-cta')).toBe('rgb(37, 99, 235)');
});

test('zatvaranje (×) vraća original i uklanja panel; ponovni klik bookmarkleta ga sakriva/prikazuje', async ({ page }) => {
  const panel = await openPanel(page);
  await panel.locator('[data-preset="crveno-sivo"]').click();
  await page.addScriptTag({ path: PANEL }); // „drugi klik"
  await expect(panel.locator('.panel')).toBeHidden();
  await page.addScriptTag({ path: PANEL });
  await expect(panel.locator('.panel')).toBeVisible();
  await panel.getByRole('button', { name: 'Zatvori' }).click();
  await expect(page.locator('cc-panel')).toHaveCount(0);
  expect(await bg(page, 'body')).toBe('rgb(248, 250, 252)');
});

test('snippet režim: bez ?cc=1 se ne prikazuje, sa ?cc=1 da', async ({ page }) => {
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

test('bookmarklet (ceo kod u linku) radi', async ({ page }) => {
  const url = readFileSync(BOOKMARKLET, 'utf8');
  expect(url.startsWith('javascript:')).toBe(true);
  const code = decodeURIComponent(url.slice('javascript:'.length));
  await page.evaluate(code);
  await expect(page.locator('cc-panel').getByText('Nova paleta')).toBeVisible();
});

test('drmozgovich.top (snimak): panel prepoznaje paletu i primenjuje preset', async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto('/drmozgovich/');
  const panel = await openPanel(page);
  await expect(panel.locator('[data-role-group="accent"] .chip.base')).toHaveAttribute('data-color', '#3e9fd9');
  await panel.locator('[data-preset="crveno-sivo"]').click();
  expect(await bg(page, 'body')).toBe('rgb(250, 250, 250)');
  expect(await bg(page, 'a.btn-primary.btn-sm', 'color')).toBe('rgb(243, 243, 248)');
});
