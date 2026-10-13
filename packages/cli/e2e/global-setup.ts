import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default function globalSetup() {
  for (const script of ['../scripts/build.mjs', '../../postcss-cc-remap/scripts/build.mjs']) {
    execFileSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], { stdio: 'inherit' });
  }
}
