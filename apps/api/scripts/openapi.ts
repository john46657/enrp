/**
 * Erzeugt docs/openapi.json und docs/api-endpunkte.md aus den Routen-Schemas.
 * Aufruf: pnpm --filter @enrp/api openapi (keine Datenbankverbindung nötig).
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { MemoryQueue, NotConfiguredDiscordGateway, noopRealtime } from '@enrp/core';
import { createDatabase } from '@enrp/database';
import { RealtimeHub } from '@enrp/integrations';
import { buildApp } from '../src/app';
import { apiEnvSchema } from '../src/env';
import { Metrics } from '../src/lib/metrics';
import { createOAuthClients } from '../src/lib/oauth';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const env = apiEnvSchema.parse({
  DATABASE_URL: 'postgres://unused:unused@localhost:1/unused',
  BOT_API_TOKEN: 'x'.repeat(32),
  HASH_SECRET: 'x'.repeat(32),
  PUBLIC_URL: 'https://dashboard.example.de',
  ENABLE_API_DOCS: 'true',
  LOG_LEVEL: 'silent',
});
const database = createDatabase(env.DATABASE_URL);
const app = await buildApp(
  {
    env,
    database,
    core: {
      db: database.db,
      now: () => new Date(),
      queue: new MemoryQueue(),
      realtime: noopRealtime,
      logger: pino({ level: 'silent' }),
      discord: new NotConfiguredDiscordGateway(),
      config: { ownerDiscordIds: [], hashSecret: env.HASH_SECRET, appEnv: 'development' },
    },
    realtime: new RealtimeHub(),
    metrics: new Metrics(),
    oauth: createOAuthClients({}),
  },
  { logger: false },
);
await app.ready();
const spec = app.swagger() as { paths: Record<string, Record<string, { tags?: string[]; summary?: string }>> };
writeFileSync(path.join(root, 'docs/openapi.json'), `${JSON.stringify(spec, null, 2)}\n`);

const byTag = new Map<string, string[]>();
for (const [route, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    const tag = op.tags?.[0] ?? 'Sonstiges';
    byTag.set(tag, [...(byTag.get(tag) ?? []), `| \`${method.toUpperCase()}\` | \`${route}\` | ${op.summary ?? ''} |`]);
  }
}
const md = [
  '# API-Endpunkte (generiert)',
  '',
  'Automatisch aus den Routen-Schemas erzeugt (`pnpm --filter @enrp/api openapi`). Vollständige Schemas: [openapi.json](openapi.json),',
  'interaktiv unter `/api/docs` (außerhalb der Produktion oder mit `ENABLE_API_DOCS=true`).',
  '',
  ...[...byTag.entries()].flatMap(([tag, rows]) => [
    `## ${tag}`,
    '',
    '| Methode | Pfad | Zweck |',
    '|---|---|---|',
    ...rows,
    '',
  ]),
].join('\n');
writeFileSync(path.join(root, 'docs/api-endpunkte.md'), md);
console.log(`${Object.keys(spec.paths).length} Pfade dokumentiert.`);
await app.close();
await database.close();
