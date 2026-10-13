import { chromium, test as base, expect } from '@playwright/test';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { SiteSettings } from '../src/shared.js';

/** Test build: like the Chrome build, but with permission for all sites pre-granted (clicking the icon cannot be simulated). */
export const EXTENSION = fileURLToPath(new URL('../dist/chrome-test', import.meta.url));
export const BASE = 'http://127.0.0.1:4173';

export const EXTENSION_EN = fileURLToPath(new URL('../dist/chrome-test_en', import.meta.url));

export const test = base.extend<{ extensionDir: string; context: BrowserContext; sw: Worker; extensionId: string }>({
  /** Which version to load (Serbian by default; `test.use({ extensionDir: EXTENSION_EN })`). */
  extensionDir: [EXTENSION, { option: true }],
  context: async ({ extensionDir }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', // the new headless mode supports extensions
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
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

/** Does the same as clicking the extension icon for the tab showing `page`. */
export async function clickAction(sw: Worker, page: Page) {
  await sw.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    await (globalThis as unknown as { ccToggle(id: number): Promise<void> }).ccToggle(tab!.id!);
  }, page.url().split('#')[0]!);
}

export const bg = (page: Page, selector: string, prop = 'background-color') =>
  page.$eval(selector, (el, p) => getComputedStyle(el).getPropertyValue(p), prop);

/** Site settings from the extension's storage. */
export const siteSettings = (sw: Worker, host: string) =>
  sw.evaluate(async (k) => (await chrome.storage.local.get(k))[k] as SiteSettings | undefined, `site:${host}`);
