import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  noExternal: [/^@enrp\//],
  // Die bestehenden JavaScript-Module (legacy/) werden zur Laufzeit per require geladen.
  external: [/legacy\//],
});
