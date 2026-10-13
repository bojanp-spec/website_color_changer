import { cssFetchAllowed, MAX_CSS_BYTES } from './shared.js';
import type { BackgroundMessage } from './shared.js';

const BRIDGE_ID = 'cc-bridge';
const ALL_URLS = { origins: ['<all_urls>'] };

/** Injects the bridge (isolated world) and the panel/engine (page world), then runs `mode`. */
async function inject(tabId: number, mode: 'toggle' | 'auto') {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['bridge.js'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['page.js'], world: 'MAIN' });
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (m: string) => (window as unknown as { __ccExt?: { run(mode: string): void } }).__ccExt?.run(m),
    args: [mode],
  });
}

/** Icon click: open/hide the panel on this tab (activeTab grants temporary access). */
async function toggle(tabId: number) {
  try {
    await inject(tabId, 'toggle');
  } catch (e) {
    // chrome://, the extension store, PDFs… — extensions are not allowed to run there.
    console.warn('Website Color Changer: ne mogu da pokrenem panel na ovoj stranici.', e);
  }
}

/** With permission for all sites: the bridge loads everywhere and applies the saved palette automatically. */
async function syncAutoScript() {
  const granted = await chrome.permissions.contains(ALL_URLS);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [BRIDGE_ID] });
  if (granted && !existing.length) {
    await chrome.scripting.registerContentScripts([
      { id: BRIDGE_ID, matches: ['<all_urls>'], js: ['bridge.js'], runAt: 'document_idle', persistAcrossSessions: true },
    ]);
  } else if (!granted && existing.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE_ID] });
  }
}

async function fetchCss(href: string, pageUrl: string): Promise<string> {
  const refused = cssFetchAllowed(href, pageUrl);
  if (refused) throw new Error(refused);
  const res = await fetch(href, { credentials: 'omit', redirect: 'follow', cache: 'force-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const after = cssFetchAllowed(res.url, pageUrl);
  if (after) throw new Error(`preusmerenje: ${after}`);
  const type = res.headers.get('content-type') ?? '';
  if (!/\btext\/css\b/i.test(type)) throw new Error(`nije CSS (${type || 'bez content-type'})`);
  const text = await res.text();
  if (text.length > MAX_CSS_BYTES) throw new Error('CSS je prevelik');
  return text;
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) void toggle(tab.id);
});

chrome.runtime.onMessage.addListener((msg: BackgroundMessage, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (msg.type === 'fetch-css') {
    if (!sender.tab?.url) {
      sendResponse({ ok: false, error: 'samo sa stranice' });
      return false;
    }
    fetchCss(msg.href, sender.tab.url).then(
      (value) => sendResponse({ ok: true, value }),
      (e: unknown) => sendResponse({ ok: false, error: String((e as Error)?.message ?? e) }),
    );
    return true; // asynchronous response
  }
  if (msg.type === 'inject-auto' && tabId !== undefined) {
    inject(tabId, 'auto').catch((e: unknown) => console.warn('Website Color Changer: automatska primena nije uspela.', e));
    return false;
  }
  if (msg.type === 'permissions-changed') void syncAutoScript();
  return false;
});

chrome.permissions.onAdded.addListener(() => void syncAutoScript());
chrome.permissions.onRemoved.addListener(() => void syncAutoScript());
chrome.runtime.onInstalled.addListener(() => void syncAutoScript());
chrome.runtime.onStartup.addListener(() => void syncAutoScript());

// For tests and debugging from the service worker console.
Object.assign(globalThis, { ccToggle: toggle, ccSyncAutoScript: syncAutoScript });
