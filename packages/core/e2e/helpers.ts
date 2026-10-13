import type { Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { ScanOptions, ScanResult } from '../src/index.js';

export const BUNDLE = fileURLToPath(new URL('../dist/cc-core.iife.js', import.meta.url));

export type SerializedScan = Omit<ScanResult, 'usages' | 'pairElements' | 'scopes'> & {
  usages: (Omit<ScanResult['usages'][number], 'element'> & { element?: string })[];
};

/** Injects the core bundle into the page and returns the serialized scan result. */
export async function scan(page: Page, opts: Omit<ScanOptions, 'fetchCss'> & { fetchCss?: false } = {}): Promise<SerializedScan> {
  await page.addScriptTag({ path: BUNDLE });
  return page.evaluate(async (o) => {
    const r = await (window as unknown as { CC: typeof import('../src/index.js') }).CC.scanDocument(document, o);
    const { pairElements: _p, scopes: _s, ...rest } = r;
    return {
      ...rest,
      usages: r.usages.map(({ element, ...u }) => (element ? { ...u, element: element.localName } : u)),
    };
  }, opts);
}

export const find = (r: SerializedScan, pred: (u: SerializedScan['usages'][number]) => boolean) => r.usages.filter(pred);
export const paletteEntry = (r: SerializedScan, key: string) => r.palette.find((p) => p.key === key);
