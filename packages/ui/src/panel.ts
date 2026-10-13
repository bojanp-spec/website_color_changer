import { createEngine, parseColor, PRESET_LABELS, PRESETS, toHex } from '@cc/core';
import type { ApplyReport, Classification, ColorEngine, EngineOptions, Palette, Role, ScanResult } from '@cc/core';
import { localStorageAdapter, paletteFromHash, shareUrl } from './state.js';
import type { PanelStorage, Saved } from './state.js';
import { PANEL_CSS } from './styles.js';

export interface PanelHandle {
  readonly engine: ColorEngine;
  readonly host: HTMLElement;
  /** Prikaži/sakrij panel (sajt ostaje u trenutnom stanju). */
  toggleVisible(): void;
  /** Ukloni panel i vrati sajt u original. */
  destroy(): void;
}

export interface PanelOptions {
  /** Paleta koja se odmah primenjuje (npr. iz URL hash-a). Podrazumevano: iz `#cc=…`. */
  initialPalette?: Palette | null;
  /** Memorija za podešavanja po domenu. Podrazumevano localStorage sajta. */
  storage?: PanelStorage;
  /** Opcije engine-a (npr. `fetchCss` preko ekstenzije). */
  engine?: EngineOptions;
  /** Ekstenzija: prekidač „automatski primeni na ovom sajtu". */
  autoApply?: { get(): Promise<boolean>; set(on: boolean): Promise<void> };
  /** Poziva se kad korisnik zatvori panel. */
  onClose?: () => void;
}

const ROLES: { role: keyof Palette; label: string; share: string }[] = [
  { role: 'dominant', label: 'Dominantna', share: '60%' },
  { role: 'secondary', label: 'Sekundarna', share: '30%' },
  { role: 'accent', label: 'Akcentna', share: '10%' },
];
const ROLE_NAMES: Record<Role, string> = {
  dominant: 'Dominantna (60%)',
  secondary: 'Sekundarna (30%)',
  accent: 'Akcentna (10%)',
  protected: 'Ne menja se',
};
const FALLBACK_ACCENT = '#e53935';
/** Koliko boja po ulozi prikazati pre „još N". */
const CHIPS_VISIBLE = 10;

type Attrs = Record<string, string | boolean | ((e: Event) => void)>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false) el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null) el.append(c);
  return el;
}

/** Kanonski `#rrggbb` (bez alfe) ili `null` za nevalidan unos. */
function normalize(input: string): string | null {
  const p = parseColor(input.trim());
  return p ? toHex({ ...p.rgba, a: 1 }) : null;
}

/**
 * Plutajući panel za izbor palete na bilo kom sajtu. Renderuje se u shadow root-u hosta
 * `<cc-panel data-cc>` — engine ga ignoriše pri skeniranju, a stilovi sajta ne dopiru do njega.
 */
export async function mountPanel(doc: Document = document, opts: PanelOptions = {}): Promise<PanelHandle> {
  const storage = opts.storage ?? localStorageAdapter;
  const saved: Saved = await storage.load().catch(() => ({}));
  const save = (patch: Partial<Saved>) => void storage.save(patch).catch(() => {});
  const host = doc.createElement('cc-panel');
  host.setAttribute('data-cc', '');
  // Otvoren shadow root: izolacija stilova je ista kao kod zatvorenog, a testovi mogu da ga čitaju.
  const root = host.attachShadow({ mode: 'open' });
  const panel = h('div', { class: saved.collapsed ? 'panel collapsed' : 'panel', role: 'dialog', 'aria-label': 'Website Color Changer' });
  attachStyles(doc, root);
  root.append(panel);
  if (saved.position) placeAt(saved.position.x, saved.position.y);
  (doc.body ?? doc.documentElement).append(host);

  const engine = createEngine(doc, opts.engine);
  let scan: ScanResult;
  let classification: Classification;
  let palette: Palette;
  let lastReport: ApplyReport | null = null;
  let activePreset: string | null = null;
  let applyTimer: ReturnType<typeof setTimeout> | null = null;
  let openMenu: HTMLElement | null = null;
  let onKey: ((e: KeyboardEvent) => void) | null = null;
  let savedOverrides: Record<string, Role> = { ...(saved.overrides ?? {}) };

  const api: PanelHandle = {
    engine,
    host,
    toggleVisible() {
      host.hidden = !host.hidden;
    },
    destroy() {
      if (applyTimer) clearTimeout(applyTimer);
      if (onKey) doc.removeEventListener('keydown', onKey);
      engine.destroy();
      host.remove();
      opts.onClose?.();
    },
  };

  // ---------------------------------------------------------------- zaglavlje
  const collapseBtn = h('button', { class: 'icon', title: 'Skupi / raširi', 'aria-label': 'Skupi panel', onclick: toggleCollapsed }, '–');
  const closeBtn = h('button', { class: 'icon', title: 'Zatvori i vrati original', 'aria-label': 'Zatvori', onclick: () => api.destroy() }, '×');
  const header = h('header', {}, h('h1', {}, '🎨 Boje sajta'), collapseBtn, closeBtn);
  header.addEventListener('pointerdown', startDrag);
  const body = h('div', { class: 'body' }, h('div', { class: 'loading' }, 'Analiziram boje sajta…'));
  panel.append(header, body);

  try {
    ({ scan, classification } = await engine.analyze());
    for (const [key, role] of Object.entries(saved.overrides ?? {})) engine.setRoleOverride(key, role);
    classification = engine.classification ?? classification;
  } catch (e) {
    body.replaceChildren(h('div', { class: 'status warn' }, `Analiza nije uspela: ${String((e as Error)?.message ?? e)}`));
    return api;
  }

  const detected: Palette = {
    dominant: classification.bases.dominant.slice(0, 7),
    secondary: classification.bases.secondary.slice(0, 7),
    accent: classification.bases.accent?.slice(0, 7) ?? FALLBACK_ACCENT,
  };
  const fromUrl = opts.initialPalette === undefined ? paletteFromHash() : opts.initialPalette;
  palette = fromUrl ?? saved.palette ?? detected;

  // ---------------------------------------------------------------- sekcije
  const detectedSection = h('section');
  const pickers = new Map<keyof Palette, { color: HTMLInputElement; text: HTMLInputElement }>();
  const pickerSection = h('section', {}, h('h2', {}, 'Nova paleta'));
  for (const { role, label, share } of ROLES) {
    const color = h('input', { type: 'color', 'aria-label': `${label} boja`, 'data-role': role }) as HTMLInputElement;
    const text = h('input', { type: 'text', spellcheck: 'false', 'aria-label': `${label} HEX`, 'data-role': role }) as HTMLInputElement;
    color.addEventListener('input', () => setRole(role, color.value, 'color'));
    text.addEventListener('input', () => setRole(role, text.value, 'text'));
    pickers.set(role, { color, text });
    pickerSection.append(h('div', { class: 'row' }, h('label', {}, `${label} `, h('small', {}, share)), color, text));
  }

  const presetGrid = h('div', { class: 'presets' });
  const presetButtons = new Map<string, HTMLButtonElement>();
  const addPreset = (id: string, name: string, p: Palette) => {
    const bar = h('span', { class: 'bar' }, ...[p.dominant, p.secondary, p.accent].map((c) => h('i', { style: `background:${c}` })));
    const btn = h('button', { class: 'preset', 'data-preset': id, 'aria-pressed': 'false', onclick: () => choosePreset(id, p) }, bar, name) as HTMLButtonElement;
    presetButtons.set(id, btn);
    presetGrid.append(btn);
  };
  addPreset('original', 'Original', detected);
  for (const [id, p] of Object.entries(PRESETS)) addPreset(id, PRESET_LABELS[id] ?? id, p);
  const presetSection = h('section', {}, h('h2', {}, 'Gotove palete'), presetGrid);

  const abBtn = h('button', { class: 'btn primary', 'data-action': 'toggle', onclick: toggleAB }, '') as HTMLButtonElement;
  const status = h('div', { class: 'status', 'aria-live': 'polite' });
  const viewSection = h('section', {}, h('div', { class: 'actions' }, abBtn), status);

  const copyCssBtn = h('button', { class: 'btn', 'data-action': 'copy-css', onclick: copyCss }, 'Kopiraj CSS') as HTMLButtonElement;
  const downloadBtn = h('button', { class: 'btn', 'data-action': 'download', onclick: downloadCss }, 'Preuzmi .css') as HTMLButtonElement;
  const linkBtn = h('button', { class: 'btn', 'data-action': 'copy-link', onclick: copyLink }, 'Kopiraj link') as HTMLButtonElement;
  const exportSection = h('section', {}, h('h2', {}, 'Izvoz'), h('div', { class: 'actions' }, copyCssBtn, downloadBtn, linkBtn));
  if (opts.autoApply) {
    const auto = opts.autoApply;
    const box = h('input', { type: 'checkbox', 'data-action': 'auto-apply' }) as HTMLInputElement;
    box.checked = await auto.get().catch(() => false);
    box.addEventListener('change', () => {
      if (box.checked && !engine.palette) applyNow();
      void auto.set(box.checked);
    });
    viewSection.append(h('label', { class: 'row check' }, box, 'Automatski primeni na ovom sajtu'));
  }

  body.replaceChildren(detectedSection, pickerSection, presetSection, viewSection, exportSection);
  renderDetected();
  syncPickers();
  if (fromUrl) applyNow();
  else renderView();

  onKey = (e: KeyboardEvent) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyC') {
      e.preventDefault();
      toggleAB();
    }
  };
  doc.addEventListener('keydown', onKey);
  const onOutside = (e: Event) => {
    // Klik na kvadratić boje sam otvara/zatvara meni (openRoleMenu); ovde samo klik „pored".
    const path = e.composedPath();
    if (openMenu && !path.includes(openMenu) && !path.some((n) => n instanceof Element && n.classList.contains('chip'))) closeMenu();
  };
  root.addEventListener('pointerdown', onOutside);

  return api;

  // ================================================================= logika

  function setRole(role: keyof Palette, value: string, from: 'color' | 'text') {
    const hex = normalize(value);
    const { color, text } = pickers.get(role)!;
    text.setAttribute('aria-invalid', hex ? 'false' : 'true');
    if (!hex) return;
    if (from === 'color') text.value = hex;
    else color.value = hex;
    palette = { ...palette, [role]: hex };
    activePreset = null;
    scheduleApply();
  }

  function syncPickers() {
    for (const { role } of ROLES) {
      const hex = normalize(palette[role]) ?? '#000000';
      const { color, text } = pickers.get(role)!;
      color.value = hex;
      text.value = hex;
      text.setAttribute('aria-invalid', 'false');
    }
  }

  function scheduleApply() {
    if (applyTimer) clearTimeout(applyTimer);
    applyTimer = setTimeout(applyNow, 50);
  }

  function applyNow() {
    applyTimer = null;
    lastReport = engine.apply(palette);
    save({ palette });
    renderView();
  }

  function choosePreset(id: string, p: Palette) {
    activePreset = id;
    palette = { ...p };
    syncPickers();
    if (id === 'original') {
      engine.disable();
      lastReport = null;
      renderView();
      return;
    }
    applyNow();
  }

  function toggleAB() {
    if (engine.applied) engine.disable();
    else if (engine.palette) lastReport = engine.apply(engine.palette);
    else applyNow();
    renderView();
  }

  function renderView() {
    for (const [id, btn] of presetButtons) btn.setAttribute('aria-pressed', String(id === activePreset || (id === 'original' && !engine.applied && !engine.palette)));
    abBtn.textContent = engine.applied ? 'Prikaži original' : engine.palette ? 'Prikaži novu paletu' : 'Primeni paletu';
    abBtn.append(' ', h('kbd', {}, 'Alt+C'));
    const exportable = !!engine.palette;
    copyCssBtn.disabled = downloadBtn.disabled = linkBtn.disabled = !exportable;

    status.className = 'status';
    if (!engine.applied || !lastReport) {
      status.textContent = engine.palette ? 'Prikazan je original sajta.' : 'Izaberi boje ili gotovu paletu.';
      return;
    }
    const r = lastReport;
    const fixedLocally = new Set(r.localContrastFixes.map((f) => `${f.fg}|${f.bg}`));
    const open = r.colorMap.failures.filter((f) => !fixedLocally.has(`${f.fg}|${f.bg}`));
    const adjusted = r.colorMap.entries.filter((e) => e.contrast).length + r.localContrastFixes.length;
    const parts = [`Primenjeno: ${r.colorMap.entries.filter((e) => e.from !== e.to).length} boja`];
    if (adjusted) parts.push(`${adjusted} korekcija kontrasta`);
    status.textContent = parts.join(' · ');
    if (open.length) {
      status.classList.add('warn');
      status.append(
        h('div', {}, `⚠ Kontrast ispod cilja: ${open.length}`),
        h('ul', {}, ...open.slice(0, 4).map((f) => h('li', {}, `${r.colorMap.map.get(f.fg) ?? f.fg} na ${r.colorMap.map.get(f.bg) ?? f.bg}`))),
      );
    }
  }

  function renderDetected() {
    const byRole = new Map<Role, string[]>();
    const order = new Map(scan.palette.map((p, i) => [p.key, i]));
    for (const r of classification.roles.values()) byRole.set(r.role, [...(byRole.get(r.role) ?? []), r.key]);
    detectedSection.replaceChildren(h('h2', {}, 'Boje sajta'));
    for (const role of ['dominant', 'secondary', 'accent', 'protected'] as Role[]) {
      const keys = (byRole.get(role) ?? []).sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
      if (!keys.length) continue;
      const base = role === 'protected' ? null : classification.bases[role];
      const chips = h('div', { class: 'chips', 'data-role-group': role });
      const make = (key: string) => chip(key, key === base);
      keys.slice(0, CHIPS_VISIBLE).forEach((k) => chips.append(make(k)));
      const label = h('div', { class: 'role-label' }, ROLE_NAMES[role], ' ', h('small', {}, `· ${keys.length}`));
      if (keys.length > CHIPS_VISIBLE) {
        const more = h('details', {}, h('summary', {}, `još ${keys.length - CHIPS_VISIBLE}`));
        const rest = h('div', { class: 'chips' });
        keys.slice(CHIPS_VISIBLE).forEach((k) => rest.append(make(k)));
        more.append(rest);
        detectedSection.append(label, chips, more);
      } else {
        detectedSection.append(label, chips);
      }
    }
  }

  function chip(key: string, isBase: boolean): HTMLElement {
    const r = classification.roles.get(key)!;
    return h('button', {
      class: isBase ? 'chip base' : 'chip',
      style: `background:${key}`,
      title: `${key} — ${r.reason}`,
      'aria-label': `${key}, ${ROLE_NAMES[r.role]}`,
      'data-color': key,
      onclick: (e) => openRoleMenu(e.currentTarget as HTMLElement, key),
    });
  }

  function openRoleMenu(anchor: HTMLElement, key: string) {
    // Drugi klik na istu boju zatvara meni.
    if (openMenu?.dataset.color === key) {
      closeMenu();
      return;
    }
    closeMenu();
    const r = classification.roles.get(key)!;
    const select = h('select', { 'aria-label': `Uloga boje ${key}` }) as HTMLSelectElement;
    for (const role of ['dominant', 'secondary', 'accent', 'protected'] as Role[]) {
      select.append(h('option', role === r.role ? { value: role, selected: true } : { value: role }, ROLE_NAMES[role]));
    }
    select.addEventListener('change', () => {
      const role = select.value as Role;
      engine.setRoleOverride(key, role);
      savedOverrides = { ...savedOverrides, [key]: role };
      save({ overrides: savedOverrides });
      classification = engine.classification ?? classification;
      closeMenu();
      renderDetected();
      if (engine.applied) {
        applyNow();
      } else {
        renderView();
        status.textContent = `Uloga boje ${key} je promenjena. Videćeš razliku kad primeniš novu paletu (Alt+C).`;
      }
    });
    select.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeMenu();
        anchor.focus();
      }
    });
    openMenu = h(
      'div',
      { class: 'menu', role: 'dialog', 'aria-label': `Uloga boje ${key}`, 'data-color': key },
      h('p', {}, h('code', {}, key), ` — ${r.reason}`),
      select,
      h('p', { class: 'hint' }, 'Uloga određuje koju boju iz „Nove palete" ova boja dobija kada je paleta primenjena.'),
    );
    // Meni NE sme biti unutar dugmeta (kvadratića): klik na padajuću listu bi „propao" do
    // dugmeta, koje bi meni zatvorilo i otvorilo ponovo — izbor se nikad ne bi upisao.
    detectedSection.append(openMenu);
    const top = anchor.offsetTop + anchor.offsetHeight + 6;
    const left = Math.max(0, Math.min(anchor.offsetLeft, detectedSection.clientWidth - openMenu.offsetWidth));
    Object.assign(openMenu.style, { top: `${top}px`, left: `${left}px` });
    select.focus();
  }

  function closeMenu() {
    openMenu?.remove();
    openMenu = null;
  }

  async function copyText(text: string, btn: HTMLButtonElement, done: string) {
    const label = btn.textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback za stranice bez dozvole za clipboard API.
      const ta = h('textarea', {}, text) as HTMLTextAreaElement;
      root.append(ta);
      ta.select();
      doc.execCommand('copy');
      ta.remove();
    }
    btn.textContent = done;
    setTimeout(() => (btn.textContent = label), 1500);
  }

  function copyCss() {
    void copyText(engine.exportCss(), copyCssBtn, 'Kopirano ✓');
  }

  function downloadCss() {
    const blob = new Blob([engine.exportCss()], { type: 'text/css' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${location.hostname || 'sajt'}-paleta.css` }) as HTMLAnchorElement;
    root.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function copyLink() {
    if (engine.palette) void copyText(shareUrl(engine.palette), linkBtn, 'Link kopiran ✓');
  }

  function toggleCollapsed() {
    panel.classList.toggle('collapsed');
    const collapsed = panel.classList.contains('collapsed');
    collapseBtn.textContent = collapsed ? '+' : '–';
    save({ collapsed });
  }

  function placeAt(x: number, y: number) {
    const maxX = Math.max(0, (doc.defaultView?.innerWidth ?? 1000) - 120);
    const maxY = Math.max(0, (doc.defaultView?.innerHeight ?? 800) - 48);
    Object.assign(host.style, {
      left: `${Math.min(Math.max(0, x), maxX)}px`,
      top: `${Math.min(Math.max(0, y), maxY)}px`,
      right: 'auto',
      bottom: 'auto',
    });
  }

  function startDrag(e: PointerEvent) {
    if ((e.target as Element).closest('button')) return;
    const rect = host.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    const move = (ev: PointerEvent) => placeAt(ev.clientX - dx, ev.clientY - dy);
    const up = () => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      const r = host.getBoundingClientRect();
      save({ position: { x: r.left, y: r.top } });
    };
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
  }
}

/**
 * Stil panela preko constructable stylesheet-a: stroga CSP (`style-src` bez 'unsafe-inline')
 * blokira <style>, a adoptedStyleSheets ne. Stariji browseri dobijaju <style>.
 */
function attachStyles(doc: Document, root: ShadowRoot) {
  const view = doc.defaultView ?? window;
  try {
    const sheet = new view.CSSStyleSheet();
    sheet.replaceSync(PANEL_CSS);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = doc.createElement('style');
    style.textContent = PANEL_CSS;
    root.append(style);
  }
}
