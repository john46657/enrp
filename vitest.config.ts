import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests nutzen immer den aktuellen Quellcode von @emden/shared, nicht das gebaute dist/.
    alias: { '@emden/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['{apps,packages}/*/{src,test,lib,components,app}/**/*.test.{ts,tsx}'],
    environment: 'node',
    // PGlite (PostgreSQL als WebAssembly) braucht einige Sekunden zum Starten.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
