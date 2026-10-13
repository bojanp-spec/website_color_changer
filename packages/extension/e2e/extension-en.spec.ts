import { BASE, bg, clickAction, expect, EXTENSION_EN, test } from './fixtures.js';

test.use({ extensionDir: EXTENSION_EN });

test('English extension: manifest, panel and settings are in English', async ({ context, sw, extensionId }) => {
  const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
  expect(manifest).toMatchObject({ name: 'Website Color Changer', short_name: 'Site colors', action: { default_title: 'Site colors' } });

  const page = await context.newPage();
  await page.goto(`${BASE}/blue-gray-vars/`);
  await clickAction(sw, page);
  const panel = page.locator('cc-panel');
  await expect(panel.getByText('New palette')).toBeVisible();
  await expect(panel.locator('[data-action="auto-apply"]').locator('xpath=..')).toContainText('Apply automatically on this site');
  await panel.locator('[data-preset="grafit-plavo"]').click();
  expect(await bg(page, '.btn-cta')).toBe('rgb(47, 107, 255)');

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options).toHaveTitle('Website Color Changer — settings');
  await expect(options.locator('#perm-status')).toContainText('Allowed');
  await expect(options.getByRole('heading', { name: 'Saved palettes' })).toBeVisible();
  await expect(options.locator('li[data-host="127.0.0.1"]')).toContainText('automatic');
  await expect(options.locator('li[data-host="127.0.0.1"] button')).toHaveText('Delete');
  expect(await options.locator('main').innerText()).not.toMatch(/Sačuvane|Dozvoli|Obriši|automatski/);
});
