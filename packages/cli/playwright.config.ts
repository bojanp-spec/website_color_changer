import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  timeout: 120_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'node ../../scripts/serve-fixtures.mjs',
    url: 'http://127.0.0.1:4173/blue-gray-vars/',
    reuseExistingServer: !process.env.CI,
  },
});
