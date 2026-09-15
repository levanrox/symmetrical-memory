import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Integration tests share one database, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 20_000,
    // Migrating from scratch is fsync-bound and can exceed the 10s default.
    hookTimeout: 60_000,
  },
});
