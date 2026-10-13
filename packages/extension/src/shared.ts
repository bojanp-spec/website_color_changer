import type { Palette, Role } from '@cc/core';

/** Settings for a single site in the extension's storage (chrome.storage.local). */
export interface SiteSettings {
  palette?: Palette;
  overrides?: Record<string, Role>;
  collapsed?: boolean;
  position?: { x: number; y: number };
  autoApply?: boolean;
  updated?: number;
}

export const siteKey = (hostname: string) => `site:${hostname}`;

/** Page ↔ bridge messages (window.postMessage). */
export type PageOp = 'load' | 'save' | 'fetch-css' | 'auto-get' | 'auto-set';
export interface PageRequest {
  __cc: 'req';
  id: number;
  op: PageOp;
  payload?: unknown;
}
export interface PageResponse {
  __cc: 'res';
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** Bridge/options → background messages (chrome.runtime.sendMessage). */
export type BackgroundMessage = { type: 'fetch-css'; href: string } | { type: 'inject-auto' } | { type: 'permissions-changed' };

/** The largest CSS file the extension will fetch for a page. */
export const MAX_CSS_BYTES = 5 * 1024 * 1024;

/** Local network / this machine addresses — CSS from them is fetched only for pages on the same host. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * Whether the extension may fetch `href` as CSS for the page `pageUrl`.
 * The page (and its scripts) can request a fetch — hence the restrictions:
 * http(s) only, no cookies, and not from the local network unless the page is on the same host.
 */
export function cssFetchAllowed(href: string, pageUrl: string): string | null {
  let target: URL;
  let page: URL;
  try {
    target = new URL(href);
    page = new URL(pageUrl);
  } catch {
    return 'nevalidan URL';
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return 'dozvoljeni su samo http(s) URL-ovi';
  if (isPrivateHost(target.hostname) && target.hostname !== page.hostname) return 'lokalna adresa sa druge stranice';
  return null;
}
