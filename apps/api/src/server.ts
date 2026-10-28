import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { DatabaseLockedError, openDatabase } from './db/database.js';
import { MigrationError, getMigrationStatus, migrate } from './db/migrate.js';

async function main(): Promise<void> {
  const config = loadConfig();
  // Die Datenbank wird vor dem Server erzeugt; ihr Fehler-Handler bekommt den Logger nachgereicht.
  const ref: { app?: FastifyInstance } = {};
  const db = await openDatabase(config.database, {
    onIdleError: (err) => ref.app?.log.warn({ err }, 'Ruhende Datenbankverbindung wurde getrennt'),
  });
  const app = await buildApp(config, { db });
  ref.app = app;
  app.addHook('onClose', async () => {
    await db.close();
  });
  const log = app.log;

  if (config.env === 'development') {
    // Nur in der Entwicklung automatisch; in Produktion ist "npm run db:migrate" ein eigener Schritt.
    const { applied, status } = await migrate(db);
    log.info(
      applied.length > 0
        ? `${db.label}: Migrationen angewendet (${applied.map((m) => m.version).join(', ')}), Schema-Version ${status.latest}`
        : `${db.label}: Schema aktuell (Version ${status.latest})`,
    );
  } else {
    try {
      const status = await getMigrationStatus(db);
      if (status.pending.length > 0) {
        log.warn(
          `${status.pending.length} Migration(en) ausstehend – "npm run db:migrate" ausführen. /ready meldet bis dahin "not_ready".`,
        );
      }
    } catch (err) {
      log.error({ err }, 'Migrationsstand konnte beim Start nicht geprüft werden');
    }
  }

  // Sauberes Herunterfahren, damit laufende Anfragen beim Deployment nicht abbrechen.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      log.info({ signal }, 'Fahre herunter …');
      app.close().then(
        () => process.exit(0),
        (err: unknown) => {
          log.error({ err }, 'Fehler beim Herunterfahren');
          process.exit(1);
        },
      );
    });
  }

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError || err instanceof DatabaseLockedError || err instanceof MigrationError) {
    console.error(`❌ ${err.message}`);
  } else {
    console.error('❌ Emden Network Backend konnte nicht starten:', err);
  }
  process.exit(1);
});
