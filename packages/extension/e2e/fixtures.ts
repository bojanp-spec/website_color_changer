import { chromium, test as base, expect } from '@playwright/test';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { SiteSettings } from '../src/shared.js';

/** Test build: kao Chrome build, ali sa unapred datom dozvolom za sve sajtove (klik na ikonicu se ne može simulirati). */
export const EXTENSION = fileURLToPath(new URL('../dist/chrome-test', import.meta.url));
export const BASE = 'http://127.0.0.1:4173';

export const test = base.extend<{ context: BrowserContext; sw: Worker; extensionId: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', // novi headless režim podržava ekstenzije
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    await use(context);
    await context.close();
  },
  sw: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(sw);
  },
  extensionId: async ({ sw }, use) => {
    await use(new URL(sw.url()).host);
  },
});
export { expect };

/** Isto što radi klik na ikonicu ekstenzije za tab sa stranicom `page`. */
export async function clickAction(sw: Worker, page: Page) {
  await sw.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    await (globalThis as unknown as { ccToggle(id: number): Promise<void> }).ccToggle(tab!.id!);
  }, page.url().split('#')[0]!);
}

export const bg = (page: Page, selector: string, prop = 'background-color') =>
  page.$eval(selector, (el, p) => getComputedStyle(el).getPropertyValue(p), prop);

/** Podešavanja sajta iz memorije ekstenzije. */
export const siteSettings = (sw: Worker, host: string) =>
  sw.evaluate(async (k) => (await chrome.storage.local.get(k))[k] as SiteSettings | undefined, `site:${host}`);
