import { BASE, bg, clickAction, expect, siteSettings, test } from './fixtures.js';

test('klik na ikonicu otvara panel; paleta se čuva u ekstenziji, ne u localStorage sajta', async ({ context, sw }) => {
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

  // drugi klik sakriva panel (sajt ostaje u novoj paleti), treći ga vraća
  await clickAction(sw, page);
  await expect(panel.locator('.panel')).toBeHidden();
  expect(await bg(page, 'body')).toBe('rgb(250, 250, 250)');
  await clickAction(sw, page);
  await expect(panel.locator('.panel')).toBeVisible();
});

test('stroga CSP: bookmarklet-način je blokiran, ekstenzija radi (i panel ima stil)', async ({ context, sw }) => {
  const page = await context.newPage();
  await page.goto(`${BASE}/strict-csp/`);
  // Inline skripta (kao bookmarklet/snippet) — CSP je blokira.
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

test('CSS sa drugog domena bez CORS-a: ekstenzija ga preuzima, boje idu kroz CSS sloj (bez inline zakrpa)', async ({ context, sw }) => {
  const page = await context.newPage();
  await page.goto(`${BASE}/cross-origin/`);
  const before = await bg(page, '.remote-nocors');
  await clickAction(sw, page);
  const panel = page.locator('cc-panel');
  await expect(panel.getByText('Nova paleta')).toBeVisible();
  await panel.locator('[data-preset="crveno-sivo"]').click();
  await expect.poll(() => bg(page, '.remote-nocors')).not.toBe(before);
  // Pozadina je iz CSS sloja (stylesheet je preuzet), ne iz computed fallback-a koji piše inline.
  // (Inline `color` može da postoji — to je lokalna korekcija kontrasta teksta.)
  expect(await page.getAttribute('.remote-nocors', 'style')).not.toContain('background');
});

test('bezbednost: stranica ne može da natera ekstenziju da preuzme nešto što nije njen stylesheet', async ({ context, sw }) => {
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

test('automatska primena: posle osvežavanja paleta je tu bez otvaranja panela', async ({ context, sw }) => {
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

  // Klik na ikonicu sada otvara panel sa istom paletom (bez dvostrukog sloja).
  await clickAction(sw, page);
  await expect(page.locator('cc-panel').getByText('Nova paleta')).toBeVisible();
  await expect.poll(() => bg(page, '.btn-cta')).toBe('rgb(242, 183, 5)');
  await page.locator('cc-panel [data-action="toggle"]').click();
  expect(await bg(page, '.btn-cta')).toBe('rgb(37, 99, 235)'); // original — sloj nije dupliran
});

test('stranica sa podešavanjima: sačuvani sajtovi i dozvole', async ({ context, sw, extensionId }) => {
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

test('LIVE drmozgovich.top (samo sa LIVE=1)', async ({ context, sw }) => {
  test.skip(!process.env.LIVE, 'zahteva mrežni pristup sajtu');
  const page = await context.newPage();
  await page.goto('https://drmozgovich.top', { waitUntil: 'networkidle' });
  await clickAction(sw, page);
  const panel = page.locator('cc-panel');
  await expect(panel.locator('[data-role-group="accent"] .chip.base')).toHaveAttribute('data-color', '#3e9fd9');
  await panel.locator('[data-preset="crveno-sivo"]').click();
  expect(await bg(page, 'body')).toBe('rgb(250, 250, 250)');
});
