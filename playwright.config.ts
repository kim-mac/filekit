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
  // Limit rendering contention while allowing independent browser workflows to overlap.
  workers: 2,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'desktop-webkit', workers: 1, use: { ...devices['Desktop Safari'] } },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] } },
    // Run only one software-rendered WebKit profile at a time. Use --no-deps for an isolated iPhone run.
    { name: 'iphone-webkit', dependencies: ['desktop-webkit'], workers: 1, use: { ...devices['iPhone 15'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    env: { NO_UPDATE_CHECK: '1' },
    url: baseURL,
    timeout: 120_000,
  },
});
