import { mountPanel } from './panel.js';
import type { PanelHandle } from './panel.js';

export { mountPanel } from './panel.js';
export type { PanelHandle, PanelOptions } from './panel.js';
export { localStorageAdapter, paletteFromHash, shareUrl } from './state.js';
export type { PanelStorage, Saved } from './state.js';

type CCWindow = Window & { __ccPanel?: PanelHandle | Promise<PanelHandle> };

/**
 * Startup:
 * - bookmarklet / direct injection: the panel opens immediately; clicking again hides/shows it;
 * - `<script src="cc-panel.js" data-cc-snippet>` on your own site: the panel opens only with
 *   `?cc=1` or a palette in the hash (`#cc=…`), so production visitors see nothing.
 */
function boot() {
  const w = window as CCWindow;
  const script = document.currentScript;
  const snippet = !!script?.hasAttribute('data-cc-snippet');
  if (snippet && !/[?&]cc=1\b/.test(location.search) && !/(^#|&)cc=/.test(location.hash)) return;
  const existing = w.__ccPanel;
  if (existing) {
    void Promise.resolve(existing).then((p) => (p.host.isConnected ? p.toggleVisible() : start()));
    return;
  }
  start();

  function start() {
    const run = () => {
      w.__ccPanel = mountPanel(document);
      void w.__ccPanel.then((p) => {
        w.__ccPanel = p;
        const destroy = p.destroy.bind(p);
        p.destroy = () => {
          destroy();
          delete w.__ccPanel;
        };
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !(window as { __ccNoBoot?: boolean }).__ccNoBoot) boot();
