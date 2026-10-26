import { randomUUID } from 'node:crypto';
import { Queue, Worker, type Job } from 'bullmq';
import { createLogger } from '@enrp/config';
import { monitoring, NotConfiguredDiscordGateway, QUEUE_NAMES, type CoreContext } from '@enrp/core';
import { createDatabase } from '@enrp/database';
import { BullJobQueue, DiscordRestGateway, RedisRealtimePublisher, createRedis } from '@enrp/integrations';
import { loadWorkerEnv } from './env';
import { createProcessors } from './processors';

const env = loadWorkerEnv();
const logger = createLogger('worker', env.LOG_LEVEL);
const database = createDatabase(env.DATABASE_URL, { max: 10, applicationName: 'enrp-worker' });
const connection = createRedis(env.REDIS_URL, 'enrp-worker');
const queue = new BullJobQueue(connection);
const ctx: CoreContext = {
  db: database.db,
  now: () => new Date(),
  queue,
  realtime: new RedisRealtimePublisher(connection),
  logger,
  discord: env.DISCORD_BOT_TOKEN ? new DiscordRestGateway(env.DISCORD_BOT_TOKEN) : new NotConfiguredDiscordGateway(),
  config: { ownerDiscordIds: env.OWNER_DISCORD_IDS, hashSecret: env.HASH_SECRET, guildId: env.DISCORD_GUILD_ID, verifiedRoleId: env.VERIFIED_ROLE_ID, appEnv: env.APP_ENV },
};

const processors = createProcessors(ctx, env, {
  databaseUrl: env.DATABASE_URL,
  dir: env.BACKUP_DIR,
  retentionDays: env.BACKUP_RETENTION_DAYS,
  pgDump: env.PG_DUMP_PATH,
  pgRestore: env.PG_RESTORE_PATH,
  restoreTestUrl: env.RESTORE_TEST_DATABASE_URL,
  restoreTargets: { development: env.RESTORE_TARGET_DEVELOPMENT_URL, staging: env.RESTORE_TARGET_STAGING_URL, production: env.RESTORE_TARGET_PRODUCTION_URL },
  allowProductionRestore: env.ALLOW_PRODUCTION_RESTORE,
});

async function handle(job: Job) {
  const processor = processors[job.queueName]?.[job.name];
  if (!processor) throw new Error(`Unbekannter Job ${job.queueName}/${job.name}`);
  const runId = await monitoring.recordJobStart(ctx.db, { queue: job.queueName, name: job.name, jobId: job.id, attempts: job.attemptsMade + 1 }, ctx.now());
  try {
    const result = await processor(job.data as Record<string, unknown>);
    await monitoring.recordJobEnd(ctx.db, runId, { status: 'succeeded', result: result && typeof result === 'object' ? JSON.parse(JSON.stringify(result)) : null }, ctx.now());
    ctx.realtime.publish('jobs', 'job.succeeded', { queue: job.queueName, name: job.name });
    return result;
  } catch (err) {
    const message = (err as Error).message;
    await monitoring.recordJobEnd(ctx.db, runId, { status: 'failed', error: message }, ctx.now());
    ctx.realtime.publish('jobs', 'job.failed', { queue: job.queueName, name: job.name, error: message.slice(0, 200) });
    throw err;
  }
}

// Backups laufen einzeln, alle anderen Warteschlangen parallel (begrenzt).
const workers = QUEUE_NAMES.map(
  (name) =>
    new Worker(name, handle, {
      connection: createRedis(env.REDIS_URL, `enrp-worker-${name}`),
      concurrency: name === 'backups' ? 1 : env.WORKER_CONCURRENCY,
      // Discord-REST nicht überlasten.
      limiter: name === 'discord' ? { max: 20, duration: 1000 } : undefined,
    }),
);
for (const w of workers) {
  w.on('failed', (job, err) => logger.warn({ queue: w.name, job: job?.name, attempts: job?.attemptsMade, err: err.message }, 'Job fehlgeschlagen'));
}

// Wiederkehrende Aufgaben (idempotent registriert, laufen auch bei mehreren Worker-Instanzen nur einmal).
const maintenance = new Queue('maintenance', { connection });
const backupsQueue = new Queue('backups', { connection });
await maintenance.upsertJobScheduler('tick-minute', { every: 60_000 }, { name: 'tick.minute', data: {}, opts: { attempts: 1 } });
await maintenance.upsertJobScheduler('retention-daily', { pattern: '30 3 * * *', tz: 'UTC' }, { name: 'retention.apply', data: {}, opts: { attempts: 3 } });
await backupsQueue.upsertJobScheduler('backup-scheduled', { pattern: env.BACKUP_CRON, tz: 'UTC' }, { name: 'backup.run', data: { kind: 'scheduled', triggeredBy: 'system:scheduler' }, opts: { attempts: 1 } });

const instanceId = `${process.env.HOSTNAME ?? 'local'}-${randomUUID().slice(0, 8)}`;
const startedAt = new Date();
const beat = async () => {
  await monitoring
    .recordServiceHeartbeat(ctx.db, { service: 'worker', instanceId, version: env.APP_VERSION, startedAt, info: { queues: await queue.counts().catch(() => null) } }, new Date())
    .catch((err) => logger.warn({ err: (err as Error).message }, 'Heartbeat fehlgeschlagen'));
};
await beat();
const heartbeat = setInterval(beat, 30_000);
logger.info({ discord: ctx.discord.configured }, 'Worker gestartet');

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Worker fährt herunter (laufende Jobs werden abgeschlossen) …');
    clearInterval(heartbeat);
    const force = setTimeout(() => process.exit(1), 30_000);
    await Promise.allSettled(workers.map((w) => w.close()));
    await Promise.allSettled([maintenance.close(), backupsQueue.close(), queue.close()]);
    connection.disconnect();
    await database.close();
    clearTimeout(force);
    process.exit(0);
  });
}
