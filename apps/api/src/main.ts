import { randomUUID } from 'node:crypto';
import { automations, monitoring, releases } from '@enrp/core';
import { createDatabase, runMigrations, seedDatabase } from '@enrp/database';
import { buildApp } from './app';
import { createDeps } from './deps';
import { loadApiEnv } from './env';

const env = loadApiEnv();
if (process.env.RUN_MIGRATIONS === 'true') {
  await runMigrations(env.DATABASE_URL);
  // Grunddaten (Rollen, Fraktionen, Flags, Umgebungen) anlegen – bestehende Einträge bleiben unverändert.
  const seedHandle = createDatabase(env.DATABASE_URL, { max: 1, applicationName: 'enrp-seed' });
  await seedDatabase(seedHandle.db).finally(() => seedHandle.close());
}
const deps = createDeps(env);
const app = await buildApp(deps);
const instanceId = `${process.env.HOSTNAME ?? 'local'}-${randomUUID().slice(0, 8)}`;
const startedAt = new Date();

async function reportAlive() {
  await monitoring
    .recordServiceHeartbeat(
      deps.core.db,
      { service: 'api', instanceId, version: env.APP_VERSION, startedAt },
      new Date(),
    )
    .catch((err) => app.log.warn({ err }, 'Heartbeat fehlgeschlagen'));
}

// Nicht geheime Konfiguration für /env compare melden (Schlüssel: gesetzt ja/nein, keine Werte).
await releases
  .reportEnvironment(deps.core.db, env.APP_ENV, {
    version: env.APP_VERSION,
    url: env.PUBLIC_URL,
    config: {
      LOG_LEVEL: env.LOG_LEVEL,
      TRUST_PROXY: env.TRUST_PROXY,
      BODY_LIMIT_BYTES: env.BODY_LIMIT_BYTES,
      REDIS: Boolean(env.REDIS_URL),
      DISCORD_OAUTH: Boolean(env.DISCORD_CLIENT_ID),
      DISCORD_BOT: Boolean(env.DISCORD_BOT_TOKEN),
      ROBLOX_OAUTH: Boolean(env.ROBLOX_CLIENT_ID),
      OWNER_COUNT: env.OWNER_DISCORD_IDS.length,
    },
  })
  .catch(() => undefined);

await reportAlive();
const heartbeat = setInterval(reportAlive, 30_000);

// Hohe Fehlerquote dieser Instanz an die Automatisierungen melden (nur bei ausreichend vielen Anfragen).
const errorWatch = setInterval(() => {
  const { last5Minutes } = deps.metrics.snapshot();
  if (last5Minutes.requests >= 20 && (last5Minutes.errorRate ?? 0) > 5) {
    void automations
      .fireTrigger(deps.core, 'error_rate_high', {
        summary: `API-Fehlerquote ${last5Minutes.errorRate} % (${last5Minutes.requests} Anfragen in 5 Min.).`,
        dedupeKey: 'api-error-rate',
      })
      .catch((err) => app.log.warn({ err }, 'Automatisierung fehlgeschlagen'));
  }
}, 60_000);

await app.listen({ host: env.API_HOST, port: env.API_PORT });

// Sauberes Herunterfahren: keine neuen Anfragen, laufende abschließen, Verbindungen schließen.
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Fahre herunter …');
    clearInterval(heartbeat);
    clearInterval(errorWatch);
    const force = setTimeout(() => process.exit(1), 15_000);
    try {
      await app.close();
      await deps.bullQueue?.close();
      deps.redis?.disconnect();
      await deps.database.close();
    } finally {
      clearTimeout(force);
      process.exit(0);
    }
  });
}
