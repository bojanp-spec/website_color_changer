/** Panel styles. They live in the shadow root: the site doesn't affect the panel, and the panel doesn't affect the site. */
export const PANEL_CSS = `
:host {
  all: initial;
  position: fixed;
  z-index: 2147483647;
  right: 16px;
  bottom: 16px;
  --bg: #ffffff;
  --fg: #1d1d1f;
  --muted: #6b6b70;
  --line: #e3e3e6;
  --soft: #f4f4f6;
  --focus: #2b6cb0;
  --warn: #9a5b00;
  --shadow: 0 12px 32px rgba(0, 0, 0, .18), 0 2px 6px rgba(0, 0, 0, .08);
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--fg);
}
@media (prefers-color-scheme: dark) {
  :host {
    --bg: #1f1f22;
    --fg: #f2f2f4;
    --muted: #a0a0a8;
    --line: #36363b;
    --soft: #2a2a2e;
    --focus: #7cb7ff;
    --warn: #f0b35a;
    --shadow: 0 12px 32px rgba(0, 0, 0, .5);
  }
}
:host([hidden]) { display: none; }
* { box-sizing: border-box; }
.panel {
  width: 304px;
  max-height: calc(100vh - 32px);
  overflow: auto;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
}
header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  cursor: move;
  user-select: none;
  position: sticky;
  top: 0;
  background: var(--bg);
}
header h1 { font-size: 13px; font-weight: 600; margin: 0; flex: 1; }
.icon {
  border: 0; background: none; color: var(--muted); cursor: pointer;
  width: 24px; height: 24px; border-radius: 6px; font-size: 16px; line-height: 1;
}
.icon:hover { background: var(--soft); color: var(--fg); }
.body { padding: 4px 12px 12px; }
.collapsed .body { display: none; }
section { padding: 10px 0; border-bottom: 1px solid var(--line); }
section:last-child { border-bottom: 0; }
h2 { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; }
.row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
.row label { flex: 1; }
.row small { color: var(--muted); }
input[type="color"] {
  width: 32px; height: 28px; padding: 0; border: 1px solid var(--line); border-radius: 6px; background: none; cursor: pointer;
}
input[type="text"] {
  width: 84px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 6px;
  font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--fg); background: var(--soft);
}
input[aria-invalid="true"] { border-color: #d32f2f; }
.presets { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.preset {
  display: flex; flex-direction: column; gap: 4px; align-items: stretch;
  padding: 6px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg);
  color: var(--fg); font: inherit; font-size: 11px; cursor: pointer; text-align: left;
}
.preset:hover { border-color: var(--muted); }
.preset[aria-pressed="true"] { border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus); }
.bar { display: flex; height: 14px; border-radius: 4px; overflow: hidden; }
.bar i { display: block; }
.bar i:nth-child(1) { flex: 6; } .bar i:nth-child(2) { flex: 3; } .bar i:nth-child(3) { flex: 1; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 8px; }
.chip {
  position: relative; width: 22px; height: 22px; border-radius: 6px; border: 1px solid rgba(127, 127, 127, .4); padding: 0; cursor: pointer;
}
.chip.base { width: 30px; outline: 2px solid var(--focus); outline-offset: 1px; }
.role-label { font-size: 12px; margin-top: 4px; }
.role-label small { color: var(--muted); }
details summary { cursor: pointer; color: var(--muted); font-size: 12px; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; }
button.btn {
  flex: 1 1 auto; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--soft); color: var(--fg); font: inherit; font-weight: 500; cursor: pointer;
}
button.btn:hover:not(:disabled) { border-color: var(--muted); }
button.btn.primary { background: var(--fg); color: var(--bg); border-color: var(--fg); }
button.btn:disabled { opacity: .5; cursor: default; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.status { font-size: 12px; color: var(--muted); margin-top: 8px; min-height: 1.4em; }
.status.warn { color: var(--warn); }
.status ul { margin: 4px 0 0; padding-left: 16px; }
section { position: relative; }
.menu {
  position: absolute; z-index: 1; width: 230px; padding: 8px;
  background: var(--bg); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow);
}
.menu p { margin: 0 0 6px; font-size: 12px; }
.menu p code { font: 11px ui-monospace, monospace; }
.menu p.hint { margin: 6px 0 0; color: var(--muted); font-size: 11px; }
.menu select { width: 100%; font: inherit; padding: 4px; border-radius: 6px; border: 1px solid var(--line); background: var(--soft); color: var(--fg); }
.row.check { justify-content: flex-start; font-size: 12px; margin-top: 10px; cursor: pointer; }
.row.check input { margin: 0; }
.loading { padding: 16px 12px; color: var(--muted); }
kbd { font: 11px ui-monospace, monospace; padding: 0 4px; border: 1px solid var(--line); border-radius: 4px; }
`;
