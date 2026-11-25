import { defineConfig, devices } from '@playwright/test';

// Playwright 1.65's new Firefox interceptor misses native blob saves for
// WebP and AVIF. The legacy interceptor reports and verifies those downloads.
process.env.PLAYWRIGHT_FIREFOX_LEGACY_DOWNLOADS ??= '1';

const baseURL = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './test/e2e',
  snapshotPathTemplate: '{testDir}/../screenshots/{projectName}/{arg}{ext}',
  reporter: 'list',
  forbidOnly: Boolean(process.env.CI),
  workers: 2,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'desktop-webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 15'] } },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    env: { NO_UPDATE_CHECK: '1' },
    url: baseURL,
    timeout: 120_000,
  },
});
