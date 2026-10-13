// Svet stranice (MAIN): engine i panel. Sa ekstenzijom razgovara preko bridge-a (postMessage).
import { createEngine } from '@cc/core';
import type { ColorEngine } from '@cc/core';
import { mountPanel } from '@cc/ui/src/panel.js';
import type { PanelHandle } from '@cc/ui/src/panel.js';
import type { Saved } from '@cc/ui/src/state.js';
import type { PageOp, PageResponse } from './shared.js';

type ExtWindow = Window & { __ccExt?: { run(mode: 'toggle' | 'auto'): void } };

(() => {
  const w = window as ExtWindow;
  if (w.__ccExt) return;

  let seq = 0;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  window.addEventListener('message', (e: MessageEvent) => {
    const res = e.data as PageResponse;
    if (e.source !== window || res?.__cc !== 'res') return;
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    if (res.ok) p.resolve(res.value);
    else p.reject(new Error(res.error));
  });
  const call = <T>(op: PageOp, payload?: unknown) =>
    new Promise<T>((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      window.postMessage({ __cc: 'req', id, op, payload }, location.origin);
    });

  const engineOptions = {
    // Stilovi sa drugih domena bez CORS-a: preuzima ih ekstenzija (uz proveru u bridge/background).
    fetchCss: (href: string) => call<string>('fetch-css', href).catch(() => null),
  };
  const storage = {
    load: () => call<Saved>('load'),
    save: (patch: Partial<Saved>) => call<void>('save', patch),
  };

  let panel: Promise<PanelHandle> | null = null;
  let autoEngine: ColorEngine | null = null;

  async function runAuto() {
    if (panel || autoEngine) return;
    const saved = await storage.load();
    if (!saved.palette) return;
    autoEngine = createEngine(document, { ...engineOptions, overrides: saved.overrides ?? {} });
    await autoEngine.analyze();
    autoEngine.apply(saved.palette);
  }

  async function runToggle() {
    if (panel) {
      const p = await panel;
      if (p.host.isConnected) {
        p.toggleVisible();
        return;
      }
    }
    // Automatski primenjena paleta: vrati original pa otvori panel sa istom paletom.
    let initial = null;
    if (autoEngine) {
      initial = autoEngine.palette;
      autoEngine.destroy();
      autoEngine = null;
    }
    panel = mountPanel(document, {
      ...(initial ? { initialPalette: initial } : {}),
      storage,
      engine: engineOptions,
      autoApply: { get: () => call<boolean>('auto-get'), set: (on) => call<void>('auto-set', on) },
      onClose: () => {
        panel = null;
      },
    });
  }

  w.__ccExt = {
    run(mode) {
      void (mode === 'auto' ? runAuto() : runToggle()).catch((e: unknown) => console.warn('Website Color Changer:', e));
    },
  };
})();
