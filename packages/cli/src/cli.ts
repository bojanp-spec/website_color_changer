import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseColor, PRESETS, toHex } from '@cc/core';
import type { Palette, Role } from '@cc/core';
import { exportSite } from './export.js';

const HELP = `cc-export — izvoz palete za produkciju (jedan CSS fajl za ceo sajt)

Upotreba:
  cc-export <url> --palette <preset | "#dom,#sek,#akc"> [opcije]

Opcije:
  --pages /,/kontakt,/cenovnik   dodatne stranice (putanje u odnosu na <url>)
  --crawl <N>                    obiđi do N stranica prateći linkove sa iste domene
  --viewports 1440,390           širine prikaza (podrazumevano desktop i mobilni)
  --out theme-override.css       izlazni CSS (podrazumevano theme-override.css)
  --map paleta.map.json          mapa stara → nova boja (za PostCSS plugin)
  --report izvestaj.json         detaljan izveštaj (klasifikacija, korekcije, provera)
  --screenshots <dir>            snimci stranica sa primenjenim CSS-om
  --override "#e7f2fa=dominant"  ručna uloga boje (može više puta)
  --all-colors                   menjaj i semantičke boje / boje grafikona
  --no-verify                    preskoči proveru CSS-a na stranicama
  --no-scroll                    ne skroluj stranice pre skeniranja
  --wait <ms>                    dodatno čekanje posle učitavanja

Preseti: ${Object.keys(PRESETS).join(', ')}`;

function parseArgs(argv: string[]) {
  const flags = new Map<string, string[]>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const [name, inline] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    const boolean = ['all-colors', 'no-verify', 'no-scroll', 'help'].includes(name);
    const value = boolean ? 'true' : (inline ?? argv[++i]);
    if (value === undefined) throw new Error(`--${name} traži vrednost`);
    flags.set(name, [...(flags.get(name) ?? []), value]);
  }
  const one = (n: string) => flags.get(n)?.at(-1);
  return { positional, flags, one };
}

function parsePalette(input: string): Palette {
  const preset = PRESETS[input];
  if (preset) return preset;
  const parts = input.split(',').map((x) => x.trim());
  const hex = parts.map((p) => {
    const c = parseColor(p);
    if (!c) throw new Error(`Nevalidna boja u --palette: "${p}"`);
    return toHex({ ...c.rgba, a: 1 });
  });
  if (hex.length !== 3) throw new Error('--palette traži preset ili tačno tri boje: "#dom,#sek,#akc"');
  return { dominant: hex[0]!, secondary: hex[1]!, accent: hex[2]! };
}

function parseOverrides(list: string[] = []): Record<string, Role> {
  const out: Record<string, Role> = {};
  for (const item of list) {
    const [color, role] = item.split('=');
    const key = color && parseColor(color);
    if (!key || !['dominant', 'secondary', 'accent', 'protected'].includes(role ?? '')) {
      throw new Error(`--override "${item}": očekuje se "#boja=dominant|secondary|accent|protected"`);
    }
    out[toHex(key.rgba)] = role as Role;
  }
  return out;
}

const write = (path: string, content: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

async function main() {
  const { positional, flags, one } = parseArgs(process.argv.slice(2));
  if (one('help') || !positional[0]) {
    console.log(HELP);
    process.exit(positional[0] ? 0 : 1);
  }
  const palette = parsePalette(one('palette') ?? '');
  const screenshots = one('screenshots');
  if (screenshots) mkdirSync(screenshots, { recursive: true });
  const out = one('out') ?? 'theme-override.css';

  console.log(`🎨 cc-export ${positional[0]}`);
  const result = await exportSite({
    url: positional[0],
    palette,
    pages: (one('pages') ?? '').split(',').map((p) => p.trim()).filter(Boolean),
    crawl: Number(one('crawl') ?? 0),
    viewports: (one('viewports') ?? '1440,390').split(',').map(Number).filter((n) => n > 0),
    overrides: parseOverrides(flags.get('override')),
    allColors: one('all-colors') === 'true',
    verify: one('no-verify') !== 'true',
    scroll: one('no-scroll') !== 'true',
    wait: Number(one('wait') ?? 0),
    ...(screenshots ? { screenshots } : {}),
    bundle: fileURLToPath(new URL('./cc-core.iife.js', import.meta.url)),
    log: (l) => console.log(l),
  });

  write(out, result.css);
  const mapPath = one('map');
  if (mapPath) {
    const map = Object.fromEntries([...result.colorMap.map].filter(([from, to]) => from !== to));
    write(mapPath, `${JSON.stringify({ palette, map, localRules: result.localRules }, null, 2)}\n`);
  }
  const reportPath = one('report');
  if (reportPath) write(reportPath, `${JSON.stringify(result.report, null, 2)}\n`);

  const r = result.report;
  const regressions = r.verification.reduce((n, v) => n + v.contrastRegressions.length, 0);
  const uncovered = r.verification.reduce((n, v) => n + v.uncovered.length, 0);
  console.log(`\n✔ ${out}: ${r.rules} pravila za ${new Set(r.pages.map((p) => p.url)).size} stranica`);
  if (mapPath) console.log(`✔ ${mapPath}`);
  if (reportPath) console.log(`✔ ${reportPath}`);
  if (r.localFixes.length) console.log(`  ⚖ lokalnih korekcija kontrasta: ${r.localFixes.length}`);
  for (const w of r.warnings) console.log(`  ⚠ ${w}`);
  if (r.verification.length) {
    console.log(regressions ? `  ⚠ provera: ${regressions} tekstova sa lošijim kontrastom (detalji u --report)` : '  ✔ provera: kontrast svih tekstova OK');
    if (uncovered) console.log(`  ⚠ provera: ${uncovered} elemenata zadržava staru boju (inline stilovi?) — detalji u --report`);
  }
  process.exitCode = regressions ? 2 : 0;
}

main().catch((e: unknown) => {
  console.error(`✖ ${(e as Error)?.message ?? e}`);
  process.exit(1);
});
