import { clampAdjustment, createEngine, parseColor, PRESETS, toHex } from '@cc/core';
import type { ApplyReport, Classification, ColorEngine, EngineOptions, Palette, PaletteColor, Role, ScanResult } from '@cc/core';
import { localStorageAdapter, paletteFromHash, shareUrl } from './state.js';
import type { PanelStorage, Saved } from './state.js';
import { LANG, presetLabel, reason, roleName, t } from './i18n.js';
import { PANEL_CSS } from './styles.js';

export interface PanelHandle {
  readonly engine: ColorEngine;
  readonly host: HTMLElement;
  /** Show/hide the panel (the site stays in its current state). */
  toggleVisible(): void;
  /** Remove the panel and restore the site to the original. */
  destroy(): void;
}

export interface PanelOptions {
  /** Palette to apply immediately (e.g. from the URL hash). Default: from `#cc=…`. */
  initialPalette?: Palette | null;
  /** Storage for per-domain settings. Defaults to the site's localStorage. */
  storage?: PanelStorage;
  /** Engine options (e.g. `fetchCss` via the extension). */
  engine?: EngineOptions;
  /** Extension: the "apply automatically on this site" toggle. */
  autoApply?: { get(): Promise<boolean>; set(on: boolean): Promise<void> };
  /** Called when the user closes the panel. */
  onClose?: () => void;
}

const ROLES: { role: PaletteColor; label: string; share: string }[] = [
  { role: 'dominant', label: t('dominant'), share: '60%' },
  { role: 'secondary', label: t('secondary'), share: '30%' },
  { role: 'accent', label: t('accent'), share: '10%' },
];
const FALLBACK_ACCENT = '#e53935';
type Adjustment = 'brightness' | 'contrast';
/** How many colors per role to show before "N more". */
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

/** Canonical `#rrggbb` (no alpha) or `null` for invalid input. */
function normalize(input: string): string | null {
  const p = parseColor(input.trim());
  return p ? toHex({ ...p.rgba, a: 1 }) : null;
}

/**
 * Floating panel for picking a palette on any site. Rendered in the shadow root of the
 * `<cc-panel data-cc>` host — the engine ignores it when scanning, and site styles don't reach it.
 */
export async function mountPanel(doc: Document = document, opts: PanelOptions = {}): Promise<PanelHandle> {
  const storage = opts.storage ?? localStorageAdapter;
  const saved: Saved = await storage.load().catch(() => ({}));
  const save = (patch: Partial<Saved>) => void storage.save(patch).catch(() => {});
  const host = doc.createElement('cc-panel');
  host.setAttribute('data-cc', '');
  // Open shadow root: style isolation is the same as with a closed one, and tests can read it.
  const root = host.attachShadow({ mode: 'open' });
  const panel = h('div', { class: saved.collapsed ? 'panel collapsed' : 'panel', role: 'dialog', 'aria-label': 'Website Color Changer', lang: LANG });
  attachStyles(doc, root);
  root.append(panel);
  if (saved.position) placeAt(saved.position.x, saved.position.y);
  (doc.body ?? doc.documentElement).append(host);

  const engine = createEngine(doc, { ...opts.engine, lang: LANG });
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

  // ---------------------------------------------------------------- header
  const collapseBtn = h('button', { class: 'icon', title: t('collapse'), 'aria-label': t('collapseLabel'), onclick: toggleCollapsed }, '–');
  const closeBtn = h('button', { class: 'icon', title: t('close'), 'aria-label': t('closeLabel'), onclick: () => api.destroy() }, '×');
  const header = h('header', {}, h('h1', {}, t('title')), collapseBtn, closeBtn);
  header.addEventListener('pointerdown', startDrag);
  const body = h('div', { class: 'body' }, h('div', { class: 'loading' }, t('loading')));
  panel.append(header, body);

  try {
    ({ scan, classification } = await engine.analyze());
    for (const [key, role] of Object.entries(saved.overrides ?? {})) engine.setRoleOverride(key, role);
    classification = engine.classification ?? classification;
  } catch (e) {
    body.replaceChildren(h('div', { class: 'status warn' }, t('analysisFailed', String((e as Error)?.message ?? e))));
    return api;
  }

  const detected: Palette = {
    dominant: classification.bases.dominant.slice(0, 7),
    secondary: classification.bases.secondary.slice(0, 7),
    accent: classification.bases.accent?.slice(0, 7) ?? FALLBACK_ACCENT,
  };
  const fromUrl = opts.initialPalette === undefined ? paletteFromHash() : opts.initialPalette;
  palette = fromUrl ?? saved.palette ?? detected;

  // ---------------------------------------------------------------- sections
  const detectedSection = h('section');
  const pickers = new Map<PaletteColor, { color: HTMLInputElement; text: HTMLInputElement }>();
  const pickerSection = h('section', {}, h('h2', {}, t('newPalette')));
  for (const { role, label, share } of ROLES) {
    const color = h('input', { type: 'color', 'aria-label': t('colorLabel', label), 'data-role': role }) as HTMLInputElement;
    const text = h('input', { type: 'text', spellcheck: 'false', 'aria-label': t('hexLabel', label), 'data-role': role }) as HTMLInputElement;
    color.addEventListener('input', () => setRole(role, color.value, 'color'));
    text.addEventListener('input', () => setRole(role, text.value, 'text'));
    pickers.set(role, { color, text });
    pickerSection.append(h('div', { class: 'row' }, h('label', {}, `${label} `, h('small', {}, share)), color, text));
  }
  const sliders = new Map<Adjustment, { range: HTMLInputElement; value: HTMLOutputElement }>();
  for (const adj of ['brightness', 'contrast'] as const) {
    const range = h('input', { type: 'range', min: '-100', max: '100', step: '1', 'aria-label': t(adj), 'data-adjust': adj }) as HTMLInputElement;
    const value = h('output', {}) as HTMLOutputElement;
    const reset = h('button', { class: 'icon reset', title: t('resetSlider'), 'aria-label': `${t(adj)}: ${t('resetSlider')}`, onclick: () => setAdjustment(adj, 0) }, '↺');
    range.addEventListener('input', () => setAdjustment(adj, range.valueAsNumber));
    range.addEventListener('dblclick', () => setAdjustment(adj, 0));
    sliders.set(adj, { range, value });
    pickerSection.append(h('div', { class: 'row slider' }, h('label', {}, t(adj)), range, value, reset));
  }
  pickerSection.append(h('p', { class: 'hint' }, t('slidersHint')));

  const presetGrid = h('div', { class: 'presets' });
  const presetButtons = new Map<string, HTMLButtonElement>();
  const addPreset = (id: string, name: string, p: Palette) => {
    const bar = h('span', { class: 'bar' }, ...[p.dominant, p.secondary, p.accent].map((c) => h('i', { style: `background:${c}` })));
    const btn = h('button', { class: 'preset', 'data-preset': id, 'aria-pressed': 'false', onclick: () => choosePreset(id, p) }, bar, name) as HTMLButtonElement;
    presetButtons.set(id, btn);
    presetGrid.append(btn);
  };
  addPreset('original', t('original'), detected);
  for (const [id, p] of Object.entries(PRESETS)) addPreset(id, presetLabel(id), p);
  const presetSection = h('section', {}, h('h2', {}, t('presets')), presetGrid);

  const abBtn = h('button', { class: 'btn primary', 'data-action': 'toggle', onclick: toggleAB }, '') as HTMLButtonElement;
  const status = h('div', { class: 'status', 'aria-live': 'polite' });
  const viewSection = h('section', {}, h('div', { class: 'actions' }, abBtn), status);

  const copyCssBtn = h('button', { class: 'btn', 'data-action': 'copy-css', onclick: copyCss }, t('copyCss')) as HTMLButtonElement;
  const downloadBtn = h('button', { class: 'btn', 'data-action': 'download', onclick: downloadCss }, t('downloadCss')) as HTMLButtonElement;
  const linkBtn = h('button', { class: 'btn', 'data-action': 'copy-link', onclick: copyLink }, t('copyLink')) as HTMLButtonElement;
  const exportSection = h('section', {}, h('h2', {}, t('export')), h('div', { class: 'actions' }, copyCssBtn, downloadBtn, linkBtn));
  if (opts.autoApply) {
    const auto = opts.autoApply;
    const box = h('input', { type: 'checkbox', 'data-action': 'auto-apply' }) as HTMLInputElement;
    box.checked = await auto.get().catch(() => false);
    box.addEventListener('change', () => {
      if (box.checked && !engine.palette) applyNow();
      void auto.set(box.checked);
    });
    viewSection.append(h('label', { class: 'row check' }, box, t('autoApply')));
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
    // A click on a color swatch opens/closes the menu itself (openRoleMenu); here we only handle clicks "outside".
    const path = e.composedPath();
    if (openMenu && !path.includes(openMenu) && !path.some((n) => n instanceof Element && n.classList.contains('chip'))) closeMenu();
  };
  root.addEventListener('pointerdown', onOutside);

  return api;

  // ================================================================= logic

  function setRole(role: PaletteColor, value: string, from: 'color' | 'text') {
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

  function setAdjustment(adj: Adjustment, v: number) {
    const n = clampAdjustment(v);
    palette = { ...palette, [adj]: n };
    syncSliders();
    scheduleApply();
  }

  function syncSliders() {
    for (const [adj, { range, value }] of sliders) {
      const n = clampAdjustment(palette[adj]);
      range.value = String(n);
      value.textContent = n > 0 ? `+${n}` : String(n);
    }
  }

  function syncPickers() {
    syncSliders();
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
    // The sliders stay as they are when switching palettes.
    palette = { ...p, brightness: clampAdjustment(palette.brightness), contrast: clampAdjustment(palette.contrast) };
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
    abBtn.textContent = engine.applied ? t('showOriginal') : engine.palette ? t('showNew') : t('apply');
    abBtn.append(' ', h('kbd', {}, 'Alt+C'));
    const exportable = !!engine.palette;
    copyCssBtn.disabled = downloadBtn.disabled = linkBtn.disabled = !exportable;

    status.className = 'status';
    if (!engine.applied || !lastReport) {
      status.textContent = engine.palette ? t('originalShown') : t('pickColors');
      return;
    }
    const r = lastReport;
    const fixedLocally = new Set(r.localContrastFixes.map((f) => `${f.fg}|${f.bg}`));
    const open = r.colorMap.failures.filter((f) => !fixedLocally.has(`${f.fg}|${f.bg}`));
    const adjusted = r.colorMap.entries.filter((e) => e.contrast).length + r.localContrastFixes.length;
    const parts = [t('applied', r.colorMap.entries.filter((e) => e.from !== e.to).length)];
    if (adjusted) parts.push(t('contrastFixes', adjusted));
    status.textContent = parts.join(' · ');
    if (open.length) {
      status.classList.add('warn');
      status.append(
        h('div', {}, t('contrastLow', open.length)),
        h('ul', {}, ...open.slice(0, 4).map((f) => h('li', {}, t('onBg', r.colorMap.map.get(f.fg) ?? f.fg, r.colorMap.map.get(f.bg) ?? f.bg)))),
      );
    }
  }

  function renderDetected() {
    const byRole = new Map<Role, string[]>();
    const order = new Map(scan.palette.map((p, i) => [p.key, i]));
    for (const r of classification.roles.values()) byRole.set(r.role, [...(byRole.get(r.role) ?? []), r.key]);
    detectedSection.replaceChildren(h('h2', {}, t('siteColors')));
    for (const role of ['dominant', 'secondary', 'accent', 'protected'] as Role[]) {
      const keys = (byRole.get(role) ?? []).sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
      if (!keys.length) continue;
      const base = role === 'protected' ? null : classification.bases[role];
      const chips = h('div', { class: 'chips', 'data-role-group': role });
      const make = (key: string) => chip(key, key === base);
      keys.slice(0, CHIPS_VISIBLE).forEach((k) => chips.append(make(k)));
      const label = h('div', { class: 'role-label' }, roleName(role), ' ', h('small', {}, `· ${keys.length}`));
      if (keys.length > CHIPS_VISIBLE) {
        const more = h('details', {}, h('summary', {}, t('more', keys.length - CHIPS_VISIBLE)));
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
      title: `${key} — ${reason(r)}`,
      'aria-label': `${key}, ${roleName(r.role)}`,
      'data-color': key,
      onclick: (e) => openRoleMenu(e.currentTarget as HTMLElement, key),
    });
  }

  function openRoleMenu(anchor: HTMLElement, key: string) {
    // A second click on the same color closes the menu.
    if (openMenu?.dataset.color === key) {
      closeMenu();
      return;
    }
    closeMenu();
    const r = classification.roles.get(key)!;
    const select = h('select', { 'aria-label': t('roleOf', key) }) as HTMLSelectElement;
    for (const role of ['dominant', 'secondary', 'accent', 'protected'] as Role[]) {
      select.append(h('option', role === r.role ? { value: role, selected: true } : { value: role }, roleName(role)));
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
        status.textContent = t('roleChanged', key);
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
      { class: 'menu', role: 'dialog', 'aria-label': t('roleOf', key), 'data-color': key },
      h('p', {}, h('code', {}, key), ` — ${reason(r)}`),
      select,
      h('p', { class: 'hint' }, t('roleHint')),
    );
    // The menu must NOT be inside the button (the swatch): a click on the dropdown would "fall through" to
    // the button, which would close and reopen the menu — the selection would never be saved.
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
      // Fallback for pages without permission for the Clipboard API.
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
    void copyText(engine.exportCss(), copyCssBtn, t('copied'));
  }

  function downloadCss() {
    const blob = new Blob([engine.exportCss()], { type: 'text/css' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${location.hostname || t('fileFallback')}-${t('fileSuffix')}.css` }) as HTMLAnchorElement;
    root.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function copyLink() {
    if (engine.palette) void copyText(shareUrl(engine.palette), linkBtn, t('linkCopied'));
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
 * Panel styles via a constructable stylesheet: a strict CSP (`style-src` without 'unsafe-inline')
 * blocks <style>, but not adoptedStyleSheets. Older browsers get a <style>.
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
