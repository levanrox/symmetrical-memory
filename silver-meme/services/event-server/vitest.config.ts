import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Never scan the compiled output: `tsc` emits CommonJS, and a compiled copy
    // of a test file cannot import vitest.
    exclude: ['dist/**', 'node_modules/**'],
    // Booting the app, migrating and running a whole category takes a moment.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
