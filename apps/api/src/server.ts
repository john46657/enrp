import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config);

  // Sauberes Herunterfahren, damit laufende Anfragen beim Deployment nicht abbrechen.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'Fahre herunter …');
      app.close().then(
        () => process.exit(0),
        (err: unknown) => {
          app.log.error({ err }, 'Fehler beim Herunterfahren');
          process.exit(1);
        },
      );
    });
  }

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(`❌ ${err.message}`);
  } else {
    console.error('❌ Emden Network Backend konnte nicht starten:', err);
  }
  process.exit(1);
});
