import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'test/golden/**/*.test.ts'],
    // Remove when Phase 1 adds its first unit or golden-file test.
    passWithNoTests: true,
  },
});
