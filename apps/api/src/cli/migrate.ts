// Wendet ausstehende Datenbankmigrationen an: npm run db:migrate
import { ConfigError, loadConfig } from '../config.js';
import { DatabaseLockedError, openDatabase } from '../db/database.js';
import { MigrationError, migrate } from '../db/migrate.js';

const pad = (version: number) => String(version).padStart(4, '0');

try {
  const config = loadConfig();
  const db = await openDatabase(config.database);
  try {
    console.log(`Datenbank: ${db.label}`);
    const { applied, status } = await migrate(db);
    if (applied.length === 0) {
      console.log(`✅ Schema ist aktuell (Version ${status.latest}). Nichts zu tun.`);
    } else {
      for (const migration of applied)
        console.log(`✅ Angewendet: ${pad(migration.version)}_${migration.name}.sql`);
      console.log(`Schema-Version jetzt: ${status.latest}`);
    }
  } finally {
    await db.close();
  }
} catch (err) {
  if (err instanceof ConfigError || err instanceof DatabaseLockedError || err instanceof MigrationError) {
    console.error(`❌ ${err.message}`);
  } else {
    console.error('❌ Migration fehlgeschlagen:', err);
  }
  process.exitCode = 1;
}
