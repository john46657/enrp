import { runMigrations } from '../src/migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL fehlt.');
  process.exit(1);
}
await runMigrations(url);
console.log('Migrationen ausgeführt.');
