import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  // Jedan persistent context sa ekstenzijom po testu; paralelno je u redu.
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  webServer: {
    command: 'node ../../scripts/serve-fixtures.mjs',
    url: 'http://127.0.0.1:4173/blue-gray-vars/',
    reuseExistingServer: !process.env.CI,
  },
});
