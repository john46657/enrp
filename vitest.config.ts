import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['development'] },
  ssr: { resolve: { conditions: ['development'] } },
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/helpers/global-setup.ts'],
    // Integrationstests teilen sich eine Test-Datenbank -> Dateien nacheinander ausführen.
    fileParallelism: false,
    testTimeout: 15_000,
    env: {
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://enrp:enrp_dev@localhost:5432/enrp_test',
    },
  },
});
