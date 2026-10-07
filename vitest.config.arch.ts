import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/architecture/**/*.arch-spec.ts'],
    // tsarch parses the whole project for each rule.
    testTimeout: 60_000,
  },
});
