import type { Palette, Role } from '@cc/core';

/** Podešavanja jednog sajta u memoriji ekstenzije (chrome.storage.local). */
export interface SiteSettings {
  palette?: Palette;
  overrides?: Record<string, Role>;
  collapsed?: boolean;
  position?: { x: number; y: number };
  autoApply?: boolean;
  updated?: number;
}

export const siteKey = (hostname: string) => `site:${hostname}`;

/** Poruke stranica ↔ bridge (window.postMessage). */
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

/** Poruke bridge/options → background (chrome.runtime.sendMessage). */
export type BackgroundMessage = { type: 'fetch-css'; href: string } | { type: 'inject-auto' } | { type: 'permissions-changed' };

/** Najveći CSS fajl koji ekstenzija preuzima za stranicu. */
export const MAX_CSS_BYTES = 5 * 1024 * 1024;

/** Adrese lokalne mreže / ovog računara — CSS sa njih se preuzima samo za stranice sa istog hosta. */
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
 * Da li ekstenzija sme da preuzme `href` kao CSS za stranicu `pageUrl`.
 * Stranica (i njene skripte) mogu da zatraže preuzimanje — zato ograničenja:
 * samo http(s), bez kolačića, i ne sa lokalne mreže osim ako je i stranica na istom hostu.
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
