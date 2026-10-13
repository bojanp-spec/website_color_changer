import { isColorFunctionName, isNamedColor, parseColor, PASSTHROUGH_KEYWORDS } from './parse.js';
import type { ParsedColor } from './parse.js';

export interface ColorMatch {
  /** Tačan tekst boje iz vrednosti. */
  text: string;
  start: number;
  end: number;
  /** `null` za `transparent`/`currentColor` i boje koje ne možemo izračunati (npr. `rgb(var(--x))`). */
  color: ParsedColor | null;
}

// Ne-ASCII kao negirana klasa: doslovni U+FFFF u izvoru/bundle-u Chrome odbija
// kao content script („isn't UTF-8 encoded").
const isIdentStart = (ch: string | undefined) => !!ch && /[a-zA-Z_\-]|[^\x00-\x7f]/.test(ch);
const isIdentChar = (ch: string | undefined) => !!ch && /[a-zA-Z0-9_\-]|[^\x00-\x7f]/.test(ch);
const isDigit = (ch: string | undefined) => !!ch && ch >= '0' && ch <= '9';

/** Indeks odmah posle `)` koja zatvara zagradu otvorenu na `openIdx`; poštuje navodnike. */
function matchParen(value: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"' || ch === "'") {
      i = skipString(value, i) - 1;
    } else if (ch === '\\') {
      i++;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')' && --depth === 0) {
      return i + 1;
    }
  }
  return value.length;
}

/** Indeks odmah posle zatvarajućeg navodnika stringa koji počinje na `i`. */
function skipString(value: string, i: number): number {
  const quote = value[i];
  for (let j = i + 1; j < value.length; j++) {
    if (value[j] === '\\') j++;
    else if (value[j] === quote) return j + 1;
  }
  return value.length;
}

/**
 * Pronalazi sve boje u vrednosti CSS svojstva (uključujući shorthand-ove, gradijente,
 * senke i `var()` fallback-ove). Sadržaj `url(...)` i stringova se preskače.
 */
export function findColors(value: string): ColorMatch[] {
  const out: ColorMatch[] = [];
  let i = 0;
  while (i < value.length) {
    const ch = value[i];

    if (ch === '"' || ch === "'") {
      i = skipString(value, i);
      continue;
    }

    if (ch === '\\') {
      i += 2;
      continue;
    }

    if (ch === '#') {
      let j = i + 1;
      while (isIdentChar(value[j])) j++;
      const text = value.slice(i, j);
      if (/^#[0-9a-f]+$/i.test(text)) {
        const color = parseColor(text);
        if (color) out.push({ text, start: i, end: j, color });
      }
      i = j;
      continue;
    }

    // Broj sa jedinicom (10px, 1.5em, 2e3) — preskače se ceo, da se `e`/`px` ne čitaju kao ime.
    if (isDigit(ch) || (ch === '.' && isDigit(value[i + 1]))) {
      let j = i + 1;
      while (isIdentChar(value[j]) || value[j] === '.' || ((value[j] === '+' || value[j] === '-') && /e/i.test(value[j - 1] ?? ''))) j++;
      if (value[j] === '%') j++;
      i = j;
      continue;
    }

    if (isIdentStart(ch) && !(ch === '-' && isDigit(value[i + 1]))) {
      let j = i;
      while (isIdentChar(value[j])) j++;
      const ident = value.slice(i, j);
      const lower = ident.toLowerCase();

      if (value[j] === '(') {
        if (lower === 'url') {
          i = matchParen(value, j);
        } else if (isColorFunctionName(lower)) {
          const end = matchParen(value, j);
          const text = value.slice(i, end);
          out.push({ text, start: i, end, color: parseColor(text) });
          i = end;
        } else {
          // Ostale funkcije (linear-gradient, var, color-mix, drop-shadow...) — ulazimo unutra.
          i = j + 1;
        }
        continue;
      }

      // Custom property imena (--brand) i delovi selektora/ključnih reči nisu boje.
      if (!ident.startsWith('--')) {
        if (PASSTHROUGH_KEYWORDS.has(lower)) {
          out.push({ text: ident, start: i, end: j, color: null });
        } else if (isNamedColor(lower)) {
          out.push({ text: ident, start: i, end: j, color: parseColor(ident) });
        }
      }
      i = j;
      continue;
    }

    i++;
  }
  return out;
}

/**
 * Zamenjuje svaku konkretnu boju u vrednosti rezultatom `fn`. Ostatak stringa
 * (url-ovi, pozicije, debljine, `transparent`, `currentColor`, `var()` reference)
 * ostaje bajt-identičan. Ako `fn` vrati `null`/`undefined`, boja ostaje ista.
 */
export function replaceColors(
  value: string,
  fn: (color: ParsedColor, text: string) => string | null | undefined,
): string {
  const matches = findColors(value);
  if (!matches.length) return value;
  let out = '';
  let last = 0;
  for (const m of matches) {
    if (!m.color) continue;
    const next = fn(m.color, m.text);
    if (next == null || next === m.text) continue;
    out += value.slice(last, m.start) + next;
    last = m.end;
  }
  return last === 0 ? value : out + value.slice(last);
}

/** Da li vrednost sadrži bar jednu konkretnu boju koju možemo da remapiramo. */
export function hasColor(value: string): boolean {
  return findColors(value).some((m) => m.color !== null);
}
