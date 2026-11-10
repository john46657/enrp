import { z } from 'zod';
import { baseEnvSchema, booleanFromString, csv, optionalString, parseEnv } from '@enrp/config';

export const workerEnvSchema = baseEnvSchema.extend({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  HASH_SECRET: z.string().min(32),
  OWNER_DISCORD_IDS: csv,
  DISCORD_BOT_TOKEN: optionalString,
  DISCORD_GUILD_ID: optionalString,
  VERIFIED_ROLE_ID: optionalString,
  DASHBOARD_URL: z.string().url().default('http://localhost:3000'),
  APP_VERSION: z.string().default('0.0.0-dev'),
  /** Getrennter Speicherort (eigenes Volume / Mount), nicht im Datenverzeichnis der Datenbank. */
  BACKUP_DIR: z.string().default('./backups'),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Cron-Ausdruck in UTC für geplante Backups. */
  BACKUP_CRON: z.string().default('0 2 * * *'),
  PG_DUMP_PATH: z.string().default('pg_dump'),
  PG_RESTORE_PATH: z.string().default('pg_restore'),
  RESTORE_TEST_DATABASE_URL: optionalString,
  RESTORE_TARGET_DEVELOPMENT_URL: optionalString,
  RESTORE_TARGET_STAGING_URL: optionalString,
  RESTORE_TARGET_PRODUCTION_URL: optionalString,
  ALLOW_PRODUCTION_RESTORE: booleanFromString.default(false),
  GITHUB_DEPLOY_REPO: optionalString,
  GITHUB_DEPLOY_WORKFLOW: z.string().default('deploy.yml'),
  GITHUB_DEPLOY_TOKEN: optionalString,
  GITHUB_DEPLOY_REF: z.string().default('main'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(4),
});
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export const loadWorkerEnv = () => parseEnv(workerEnvSchema);
