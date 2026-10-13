import { mountPanel } from './panel.js';
import type { PanelHandle } from './panel.js';

export { mountPanel } from './panel.js';
export type { PanelHandle, PanelOptions } from './panel.js';
export { paletteFromHash, shareUrl } from './state.js';

type CCWindow = Window & { __ccPanel?: PanelHandle | Promise<PanelHandle> };

/**
 * Pokretanje:
 * - bookmarklet / direktno ubacivanje: panel se otvara odmah; ponovni klik ga sakriva/prikazuje;
 * - `<script src="cc-panel.js" data-cc-snippet>` na sopstvenom sajtu: panel se otvara samo uz
 *   `?cc=1` ili paletu u hash-u (`#cc=…`), pa posetioci produkcije ništa ne vide.
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
