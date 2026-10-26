import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integrationstests teilen sich eine Datenbank; Dateien laufen daher nacheinander.
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/*.int.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.int.test.ts', 'apps/**/src/**/*.int.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          setupFiles: ['tests/integration/setup-env.ts'],
          environment: 'node',
          testTimeout: 20000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
