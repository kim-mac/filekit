import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({
  ...config,
  testDir: './test/bench',
  outputDir: './test-results/wasm-benchmark',
  projects: config.projects?.filter(({ name }) => name === 'desktop-chromium'),
  workers: 1,
});
