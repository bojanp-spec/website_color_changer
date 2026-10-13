import { BASE, bg, clickAction, expect, siteSettings, test } from './fixtures.js';

test('clicking the icon opens the panel; the palette is stored in the extension, not in the site localStorage', async ({ context, sw }) => {
  const page = await context.newPage();
  await page.goto(`${BASE}/blue-gray-vars/`);
  await clickAction(sw, page);
  const panel = page.locator('cc-panel');
  await expect(panel.getByText('Nova paleta')).toBeVisible();
  await panel.locator('[data-preset="crveno-sivo"]').click();
  expect(await bg(page, 'body')).toBe('rgb(250, 250, 250)');

  await expect
    .poll(async () => (await siteSettings(sw, '127.0.0.1'))?.palette)
    .toEqual({ dominant: '#FAFAFA', secondary: '#4B4B4F', accent: '#D32F2F' });
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);

  // a second click hides the panel (the site keeps the new palette), a third brings it back
  await clickAction(sw, page);
  await expect(panel.locator('.panel')).toBeHidden();
  expect(await bg(page, 'body')).toBe('rgb(250, 250, 250)');
  await clickAction(sw, page);
  await expect(panel.locator('.panel')).toBeVisible();
});

test('strict CSP: the bookmarklet approach is blocked, the extension works (and the panel is styled)', async ({ context, sw }) => {
  const page = await context.newPage();
  await page.goto(`${BASE}/strict-csp/`);
  // An inline script (like the bookmarklet/snippet) — CSP blocks it.
  await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__inlineRan = true';
    document.head.append(s);
  });
  expect(await page.evaluate(() => (window as unknown as { __inlineRan?: boolean }).__inlineRan)).toBeUndefined();

  await clickAction(sw, page);
  const panel = page.locator('cc-panel');
  await expect(panel.getByText('Nova paleta')).toBeVisible();
  expect(await panel.locator('.panel').evaluate((el) => getComputedStyle(el).borderRadius)).toBe('12px');
  await panel.locator('[data-preset="crveno-sivo"]').click();
  expect(await bg(page, '.cta')).toBe('rgb(211, 47, 47)');
  expect(await bg(page, 'body')).toBe('rgb(250, 250, 250)');
});

test('cross-origin CSS without CORS: the extension fetches it, colors go through the CSS layer (no inline patches)', async ({ context, sw }) => {
  const page = await context.newPage();
  await page.goto(`${BASE}/cross-origin/`);
  const before = await bg(page, '.remote-nocors');
  await clickAction(sw, page);
  const panel = page.locator('cc-panel');
  await expect(panel.getByText('Nova paleta')).toBeVisible();
  await panel.locator('[data-preset="crveno-sivo"]').click();
  await expect.poll(() => bg(page, '.remote-nocors')).not.toBe(before);
  // The background comes from the CSS layer (the stylesheet was fetched), not from the computed fallback that writes inline.
  // (An inline `color` may exist — that is a local text contrast fix.)
  expect(await page.getAttribute('.remote-nocors', 'style')).not.toContain('background');
});

test('security: a page cannot make the extension fetch anything that is not its own stylesheet', async ({ context, sw }) => {
  const page = await context.newPage();
  await page.goto(`${BASE}/cross-origin/`);
  await clickAction(sw, page);
  await expect(page.locator('cc-panel').getByText('Nova paleta')).toBeVisible();
  const ask = (href: string) =>
    page.evaluate(
      (h) =>
        new Promise<{ ok: boolean; error?: string }>((resolve) => {
          const id = 987654 + Math.floor(Math.random() * 1000);
          addEventListener('message', function on(e) {
            if (e.data?.__cc === 'res' && e.data.id === id) {
              removeEventListener('message', on);
              resolve(e.data);
            }
          });
          postMessage({ __cc: 'req', id, op: 'fetch-css', payload: h }, location.origin);
        }),
      href,
    );
  expect(await ask('http://127.0.0.1:4174/nocors/theme.css')).toMatchObject({ ok: true });
  expect(await ask('http://127.0.0.1:4173/blue-gray-vars/')).toMatchObject({ ok: false, error: 'nije stylesheet ove stranice' });
  expect(await ask('http://127.0.0.1:4174/cors/theme.css?drugo')).toMatchObject({ ok: false });
});

test('auto-apply: after a reload the palette is there without opening the panel', async ({ context, sw }) => {
  const page = await context.newPage();
  await page.goto(`${BASE}/blue-gray-vars/`);
  await clickAction(sw, page);
  const panel = page.locator('cc-panel');
  await panel.locator('[data-preset="zuto-zeleno"]').click();
  await panel.locator('[data-action="auto-apply"]').check();
  await expect
    .poll(async () => (await siteSettings(sw, '127.0.0.1'))?.autoApply)
    .toBe(true);

  await page.reload();
  await expect.poll(() => bg(page, '.btn-cta')).toBe('rgb(242, 183, 5)');
  await expect(page.locator('cc-panel')).toHaveCount(0);

  // Clicking the icon now opens the panel with the same palette (without a duplicate layer).
  await clickAction(sw, page);
  await expect(page.locator('cc-panel').getByText('Nova paleta')).toBeVisible();
  await expect.poll(() => bg(page, '.btn-cta')).toBe('rgb(242, 183, 5)');
  await page.locator('cc-panel [data-action="toggle"]').click();
  expect(await bg(page, '.btn-cta')).toBe('rgb(37, 99, 235)'); // original — the layer is not duplicated
});

test('options page: saved sites and permissions', async ({ context, sw, extensionId }) => {
  await sw.evaluate(() =>
    chrome.storage.local.set({
      'site:primer.rs': { palette: { dominant: '#fafafa', secondary: '#4b4b4f', accent: '#d32f2f' }, autoApply: false, updated: 1 },
    }),
  );
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.locator('#perm-status')).toContainText('Dozvoljeno');
  const row = page.locator('li[data-host="primer.rs"]');
  await expect(row).toBeVisible();
  await row.getByRole('checkbox').check();
  await expect.poll(async () => (await siteSettings(sw, 'primer.rs'))?.autoApply).toBe(true);
  await row.getByRole('button', { name: 'Obriši' }).click();
  await expect(row).toHaveCount(0);
  await expect(page.locator('#empty')).toBeVisible();
});

test('LIVE drmozgovich.top (only with LIVE=1)', async ({ context, sw }) => {
  test.skip(!process.env.LIVE, 'requires network access to the site');
  const page = await context.newPage();
  await page.goto('https://drmozgovich.top', { waitUntil: 'networkidle' });
  await clickAction(sw, page);
  const panel = page.locator('cc-panel');
  await expect(panel.locator('[data-role-group="accent"] .chip.base')).toHaveAttribute('data-color', '#3e9fd9');
  await panel.locator('[data-preset="crveno-sivo"]').click();
  expect(await bg(page, 'body')).toBe('rgb(250, 250, 250)');
});
