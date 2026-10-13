import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Always test a fresh bundle — even when `npx playwright test` is run directly. */
export default function globalSetup() {
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build.mjs', import.meta.url))], { stdio: 'inherit' });
}
