import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client';

/** Im gebündelten Container per MIGRATIONS_DIR überschreibbar (siehe Dockerfile). */
export const MIGRATIONS_FOLDER =
  process.env.MIGRATIONS_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

/** Führt alle ausstehenden Migrationen aus (idempotent, in einer Transaktion je Migration). */
export async function runMigrations(url: string, migrationsFolder = MIGRATIONS_FOLDER): Promise<void> {
  const handle = createDatabase(url, { max: 1, applicationName: 'enrp-migrate' });
  try {
    await migrate(handle.db, { migrationsFolder });
  } finally {
    await handle.close();
  }
}
