import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Uvek testiraj svež bundle — i kad se pokrene `npx playwright test` direktno. */
export default function globalSetup() {
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build.mjs', import.meta.url))], { stdio: 'inherit' });
}
