import { coreText } from '../i18n.js';
import type { Lang } from '../i18n.js';
import type { PaletteEntry, ScanResult } from './types.js';

const pct = (n: number) => `${(n * 100).toFixed(1).padStart(5)}%`;

function describe(e: PaletteEntry, lang: Lang): string {
  const T = coreText(lang);
  const w = e.weight;
  const parts: string[] = [];
  const total = e.area || 1;
  if (w.bgArea) parts.push(`${T.background} ${Math.round((w.bgArea / total) * 100)}%`);
  if (w.textArea) parts.push(`${T.text} ${Math.round((w.textArea / total) * 100)}%`);
  if (w.borderArea) parts.push(`${T.borders} ${Math.round((w.borderArea / total) * 100)}%`);
  if (w.svgArea) parts.push(`svg ${Math.round((w.svgArea / total) * 100)}%`);
  if (w.interactiveArea) parts.push(`${T.interactive} ${Math.round((w.interactiveArea / total) * 100)}%`);
  if (!e.area) parts.push(T.unmeasured);
  if (w.implicit) parts.push(T.implicitWhite);
  const declared = Object.entries(e.declared).map(([k, v]) => `${k}×${v}`).join(' ');
  if (declared) parts.push(`${T.declared}: ${declared}`);
  if (e.variables.length) parts.push(`var: ${e.variables.join(', ')}`);
  return parts.join(' · ');
}

/** Text report (for CLI / logs). `swatch` renders a color sample, e.g. ANSI truecolor. */
export function formatPalette(result: ScanResult, swatch: (hex: string) => string = () => '', lang: Lang = 'sr'): string {
  const T = coreText(lang);
  const lines = result.palette.map((e) => `${swatch(e.key)}${e.key.padEnd(10)} ${pct(e.share)}  ${describe(e, lang)}`);
  const blocked = result.sheets.filter((s) => s.status === 'blocked');
  lines.push('', T.stats(result.stats.elements, result.stats.rules, result.usages.length, result.stats.durationMs));
  if (blocked.length) lines.push(`${T.blockedSheets} ${blocked.map((s) => s.id).join(', ')}`);
  return lines.join('\n');
}

/** Prints the palette to the browser console, with colored swatches. */
export function printPalette(
  result: ScanResult,
  out: Pick<Console, 'log' | 'groupCollapsed' | 'groupEnd'> = console,
  lang: Lang = 'sr',
): void {
  out.groupCollapsed(`🎨 Website Color Changer — ${coreText(lang).colors(result.palette.length)}`);
  for (const e of result.palette) {
    out.log(
      `%c    %c ${e.key} ${pct(e.share)}  ${describe(e, lang)}`,
      `background:${e.key};border:1px solid #8888`,
      'background:none',
    );
  }
  out.log(formatPalette({ ...result, palette: [] }, undefined, lang).trim());
  out.groupEnd();
}
