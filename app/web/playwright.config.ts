import { defineConfig, devices } from '@playwright/test';

/**
 * PW_CHROMIUM_PATH hanya dipakai kalau diisi. Di mesin biasa Playwright memakai
 * browser hasil `npx playwright install chromium` seperti biasa; variabel ini ada
 * untuk lingkungan yang sudah menyediakan Chromium sendiri.
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './test',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000',
    ...devices['Desktop Chrome'],
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'off',
  },
});
