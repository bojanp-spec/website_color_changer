import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...devices['Desktop Chrome'],
    colorScheme: 'light',
  },
  webServer: {
    command: 'node ../../scripts/serve-fixtures.mjs',
    url: 'http://127.0.0.1:4173/blue-gray-vars/',
    reuseExistingServer: !process.env.CI,
  },
});
