import { defineConfig } from 'vitest/config';

// Unit tests run anywhere. Integration tests (*.int.spec.ts) need the real test database and run
// serially; global setup refuses to continue unless DATABASE_URL_TEST is a safe `_test` database.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts', 'seed/**/*.spec.ts'],
          exclude: ['**/*.int.spec.ts', '**/node_modules/**'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/**/*.int.spec.ts', 'seed/**/*.int.spec.ts'],
          globalSetup: ['./test/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
