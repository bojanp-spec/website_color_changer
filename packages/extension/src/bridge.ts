// Izolovani svet (content script): jedini deo koji vidi chrome.* API. Stranica (MAIN svet)
// mu se obraća preko window.postMessage; odgovara samo na poruke sa iste stranice.
import { siteKey } from './shared.js';
import type { PageRequest, PageResponse, SiteSettings } from './shared.js';

type BridgeWindow = Window & { __ccBridge?: boolean };

(() => {
  const w = window as BridgeWindow;
  if (w.__ccBridge) return;
  w.__ccBridge = true;

  const key = siteKey(location.hostname || 'local');
  const read = async (): Promise<SiteSettings> => ((await chrome.storage.local.get(key))[key] as SiteSettings | undefined) ?? {};
  const write = async (patch: Partial<SiteSettings>) => {
    await chrome.storage.local.set({ [key]: { ...(await read()), ...patch, updated: Date.now() } });
  };

  async function handle(req: PageRequest): Promise<unknown> {
    switch (req.op) {
      case 'load': {
        const { autoApply: _a, updated: _u, ...rest } = await read();
        return rest;
      }
      case 'save':
        return write(sanitize(req.payload));
      case 'auto-get':
        return (await read()).autoApply === true;
      case 'auto-set':
        return write({ autoApply: req.payload === true });
      case 'fetch-css': {
        const href = String(req.payload);
        // Samo stylesheet-ovi koje stranica zaista učitava.
        const known = Array.from(document.styleSheets).some((s) => s.href === href);
        if (!known) throw new Error('nije stylesheet ove stranice');
        const res = (await chrome.runtime.sendMessage({ type: 'fetch-css', href })) as { ok: boolean; value?: string; error?: string };
        if (!res?.ok) throw new Error(res?.error ?? 'preuzimanje nije uspelo');
        return res.value;
      }
    }
    throw new Error('nepoznata operacija');
  }

  window.addEventListener('message', (e: MessageEvent) => {
    const req = e.data as PageRequest;
    if (e.source !== window || e.origin !== location.origin || req?.__cc !== 'req') return;
    handle(req).then(
      (value) => window.postMessage({ __cc: 'res', id: req.id, ok: true, value } satisfies PageResponse, location.origin),
      (err: unknown) =>
        window.postMessage({ __cc: 'res', id: req.id, ok: false, error: String((err as Error)?.message ?? err) } satisfies PageResponse, location.origin),
    );
  });

  // Automatska primena (bridge registrovan za sve sajtove): sačuvana paleta bez otvaranja panela.
  void read().then((s) => {
    if (s.autoApply && s.palette) void chrome.runtime.sendMessage({ type: 'inject-auto' });
  });
})();

/** Samo poznata polja iz stranice idu u memoriju ekstenzije. */
function sanitize(payload: unknown): Partial<SiteSettings> {
  const p = (payload ?? {}) as Record<string, unknown>;
  const out: Partial<SiteSettings> = {};
  const hex = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  const pal = p.palette as Record<string, unknown> | undefined;
  if (pal && hex(pal.dominant) && hex(pal.secondary) && hex(pal.accent)) {
    out.palette = { dominant: pal.dominant as string, secondary: pal.secondary as string, accent: pal.accent as string };
  }
  if (p.overrides && typeof p.overrides === 'object') {
    out.overrides = Object.fromEntries(
      Object.entries(p.overrides as Record<string, unknown>).filter(
        ([k, v]) => /^#[0-9a-f]{6,8}$/i.test(k) && ['dominant', 'secondary', 'accent', 'protected'].includes(v as string),
      ),
    ) as NonNullable<SiteSettings['overrides']>;
  }
  if (typeof p.collapsed === 'boolean') out.collapsed = p.collapsed;
  const pos = p.position as { x?: unknown; y?: unknown } | undefined;
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) out.position = { x: Number(pos.x), y: Number(pos.y) };
  return out;
}
