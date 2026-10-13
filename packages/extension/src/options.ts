import type { SiteSettings } from './shared.js';

const ALL_URLS = { origins: ['<all_urls>'] };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function renderPermission() {
  const granted = await chrome.permissions.contains(ALL_URLS);
  $('perm-status').textContent = granted
    ? '✓ Dozvoljeno: stilovi sa drugih domena i automatska primena rade na svim sajtovima.'
    : 'Ekstenzija trenutno radi samo na klik (dozvola „activeTab").';
  $('perm-grant').hidden = granted;
  $('perm-revoke').hidden = !granted;
}

async function renderSites() {
  const all = (await chrome.storage.local.get(null)) as Record<string, SiteSettings>;
  const sites = Object.entries(all)
    .filter(([k, v]) => k.startsWith('site:') && v.palette)
    .sort((a, b) => (b[1].updated ?? 0) - (a[1].updated ?? 0));
  const list = $('sites');
  list.replaceChildren();
  $('empty').hidden = sites.length > 0;
  for (const [key, s] of sites) {
    const host = key.slice('site:'.length);
    const li = document.createElement('li');
    li.dataset.host = host;

    const name = document.createElement('span');
    name.className = 'host';
    name.textContent = host;

    const bar = document.createElement('span');
    bar.className = 'bar';
    bar.title = `${s.palette!.dominant} / ${s.palette!.secondary} / ${s.palette!.accent}`;
    for (const c of [s.palette!.dominant, s.palette!.secondary, s.palette!.accent]) {
      const i = document.createElement('i');
      i.style.background = c;
      bar.append(i);
    }

    const auto = document.createElement('input');
    auto.type = 'checkbox';
    auto.checked = !!s.autoApply;
    auto.addEventListener('change', async () => {
      await chrome.storage.local.set({ [key]: { ...s, autoApply: auto.checked, updated: Date.now() } });
      if (auto.checked && !(await chrome.permissions.contains(ALL_URLS))) {
        $('perm-status').textContent = 'Za automatsku primenu potrebna je dozvola za pristup sajtovima.';
      }
    });
    const label = document.createElement('label');
    label.append(auto, 'automatski');

    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Obriši';
    del.addEventListener('click', async () => {
      await chrome.storage.local.remove(key);
      void renderSites();
    });

    li.append(name, bar, label, del);
    list.append(li);
  }
}

$('perm-grant').addEventListener('click', async () => {
  // Mora direktno iz klika (user gesture).
  await chrome.permissions.request(ALL_URLS);
  await chrome.runtime.sendMessage({ type: 'permissions-changed' });
  void renderPermission();
});
$('perm-revoke').addEventListener('click', async () => {
  await chrome.permissions.remove(ALL_URLS);
  await chrome.runtime.sendMessage({ type: 'permissions-changed' });
  void renderPermission();
});
chrome.storage.onChanged.addListener(() => void renderSites());

void renderPermission();
void renderSites();
