import { defineConfig, devices } from '@playwright/test';

// Playwright 1.65's new Firefox interceptor misses native blob saves for
// WebP and AVIF. The legacy interceptor reports and verifies those downloads.
process.env.PLAYWRIGHT_FIREFOX_LEGACY_DOWNLOADS ??= '1';

const baseURL = 'http://127.0.0.1:4173';
const desktopChrome = devices['Desktop Chrome'];
const performanceSpec = '**/performance.spec.ts';

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
    { name: 'desktop-chromium', testIgnore: performanceSpec, use: desktopChrome },
    { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] } },
    // Run the 300 ms Chromium timing assertion on an idle host. Use --no-deps to run this project alone.
    {
      name: 'desktop-chromium-timing',
      dependencies: ['desktop-chromium', 'desktop-firefox', 'android-chromium'],
      testMatch: performanceSpec,
      workers: 1,
      use: desktopChrome,
    },
    // WebKit renders in software on Linux. Run both profiles in exclusive phases to keep frame timings stable.
    {
      name: 'desktop-webkit',
      dependencies: ['desktop-chromium-timing'],
      workers: 1,
      use: { ...devices['Desktop Safari'] },
    },
    { name: 'iphone-webkit', dependencies: ['desktop-webkit'], workers: 1, use: { ...devices['iPhone 15'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    env: { NO_UPDATE_CHECK: '1' },
    url: baseURL,
    timeout: 120_000,
  },
});
