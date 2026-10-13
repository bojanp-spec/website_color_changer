import type { Palette, Role } from '@cc/core';

export interface Saved {
  palette?: Palette;
  overrides?: Record<string, Role>;
  collapsed?: boolean;
  position?: { x: number; y: number };
}

/** Where the panel stores its settings. Defaults to the site's localStorage; the extension provides its own storage. */
export interface PanelStorage {
  load(): Promise<Saved>;
  save(patch: Partial<Saved>): Promise<void>;
}

export const localStorageAdapter: PanelStorage = {
  load: async () => loadSaved(),
  save: async (patch) => save(patch),
};

const key = () => `cc:${location.hostname || 'local'}`;

/** Per-domain settings. localStorage may be unavailable (private window, blocked) — then we work without it. */
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
    /* no persistent storage */
  }
}

const HASH_RE = /(^#|&)cc=([0-9a-f]{6}),([0-9a-f]{6}),([0-9a-f]{6})/i;

/** Palette from the URL hash: `#cc=fafafa,4b4b4f,d32f2f` (also works alongside an existing hash: `#section&cc=…`). */
export function paletteFromHash(hash: string = location.hash): Palette | null {
  const m = HASH_RE.exec(hash);
  return m ? { dominant: `#${m[2]}`, secondary: `#${m[3]}`, accent: `#${m[4]}` } : null;
}

/** Link to the current page with the palette in the hash (the site's existing hash is preserved). */
export function shareUrl(p: Palette, href: string = location.href): string {
  const url = new URL(href);
  const hex = (c: string) => c.replace('#', '').toLowerCase();
  const param = `cc=${hex(p.dominant)},${hex(p.secondary)},${hex(p.accent)}`;
  const rest = url.hash.replace(/^#/, '').split('&').filter((part) => part && !part.startsWith('cc=')).join('&');
  url.hash = rest ? `${rest}&${param}` : param;
  return url.toString();
}
