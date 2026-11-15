import { defineConfig } from 'vitest/config';

// Unit tests run anywhere; integration tests (*.int.spec.ts) use the real test database and Redis.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
          exclude: ['**/*.int.spec.ts', '**/node_modules/**'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['src/**/*.int.spec.ts', 'test/**/*.int.spec.ts'],
          globalSetup: ['./test/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
