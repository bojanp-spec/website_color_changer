import type { Palette, Role } from '@cc/core';

export interface Saved {
  palette?: Palette;
  overrides?: Record<string, Role>;
  collapsed?: boolean;
  position?: { x: number; y: number };
}

const key = () => `cc:${location.hostname || 'local'}`;

/** Per-domen podešavanja. localStorage može biti nedostupan (privatni prozor, blokiran) — tada radimo bez njega. */
export function loadSaved(): Saved {
  try {
    return JSON.parse(localStorage.getItem(key()) ?? '{}') as Saved;
  } catch {
    return {};
  }
}

export function save(patch: Partial<Saved>): void {
  try {
    localStorage.setItem(key(), JSON.stringify({ ...loadSaved(), ...patch }));
  } catch {
    /* bez trajnog čuvanja */
  }
}

const HASH_RE = /(^#|&)cc=([0-9a-f]{6}),([0-9a-f]{6}),([0-9a-f]{6})/i;

/** Paleta iz URL hash-a: `#cc=fafafa,4b4b4f,d32f2f` (može i uz postojeći hash: `#sekcija&cc=…`). */
export function paletteFromHash(hash: string = location.hash): Palette | null {
  const m = HASH_RE.exec(hash);
  return m ? { dominant: `#${m[2]}`, secondary: `#${m[3]}`, accent: `#${m[4]}` } : null;
}

/** Link ka trenutnoj stranici sa paletom u hash-u (postojeći hash sajta se čuva). */
export function shareUrl(p: Palette, href: string = location.href): string {
  const url = new URL(href);
  const hex = (c: string) => c.replace('#', '').toLowerCase();
  const param = `cc=${hex(p.dominant)},${hex(p.secondary)},${hex(p.accent)}`;
  const rest = url.hash.replace(/^#/, '').split('&').filter((part) => part && !part.startsWith('cc=')).join('&');
  url.hash = rest ? `${rest}&${param}` : param;
  return url.toString();
}
