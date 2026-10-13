import type { PaletteEntry, ScanResult } from './types.js';

const pct = (n: number) => `${(n * 100).toFixed(1).padStart(5)}%`;

function describe(e: PaletteEntry): string {
  const w = e.weight;
  const parts: string[] = [];
  const total = e.area || 1;
  if (w.bgArea) parts.push(`pozadina ${Math.round((w.bgArea / total) * 100)}%`);
  if (w.textArea) parts.push(`tekst ${Math.round((w.textArea / total) * 100)}%`);
  if (w.borderArea) parts.push(`ivice ${Math.round((w.borderArea / total) * 100)}%`);
  if (w.svgArea) parts.push(`svg ${Math.round((w.svgArea / total) * 100)}%`);
  if (w.interactiveArea) parts.push(`interaktivno ${Math.round((w.interactiveArea / total) * 100)}%`);
  if (!e.area) parts.push('bez izmerene površine (hover, @media, senke, skriveno)');
  if (w.implicit) parts.push('podrazumevana bela browsera');
  const declared = Object.entries(e.declared).map(([k, v]) => `${k}×${v}`).join(' ');
  if (declared) parts.push(`deklarisano: ${declared}`);
  if (e.variables.length) parts.push(`var: ${e.variables.join(', ')}`);
  return parts.join(' · ');
}

/** Tekstualni izveštaj (za CLI / logove). `swatch` iscrtava uzorak boje, npr. ANSI truecolor. */
export function formatPalette(result: ScanResult, swatch: (hex: string) => string = () => ''): string {
  const lines = result.palette.map((e) => `${swatch(e.key)}${e.key.padEnd(10)} ${pct(e.share)}  ${describe(e)}`);
  const blocked = result.sheets.filter((s) => s.status === 'blocked');
  lines.push(
    '',
    `Elemenata: ${result.stats.elements} · CSS pravila: ${result.stats.rules} · deklaracija boja: ${result.usages.length} · ${result.stats.durationMs} ms`,
  );
  if (blocked.length) lines.push(`⚠ Nedostupni stylesheet-ovi (CORS): ${blocked.map((s) => s.id).join(', ')}`);
  return lines.join('\n');
}

/** Ispis palete u konzolu browsera, sa obojenim uzorcima. */
export function printPalette(result: ScanResult, out: Pick<Console, 'log' | 'groupCollapsed' | 'groupEnd'> = console): void {
  out.groupCollapsed(`🎨 Website Color Changer — ${result.palette.length} boja`);
  for (const e of result.palette) {
    out.log(
      `%c    %c ${e.key} ${pct(e.share)}  ${describe(e)}`,
      `background:${e.key};border:1px solid #8888`,
      'background:none',
    );
  }
  out.log(formatPalette({ ...result, palette: [] }).trim());
  out.groupEnd();
}
