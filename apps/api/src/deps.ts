import { createLogger } from '@enrp/config';
import { NotConfiguredDiscordGateway, MemoryQueue, type CoreContext } from '@enrp/core';
import { createDatabase } from '@enrp/database';
import { BullJobQueue, DiscordRestGateway, RealtimeHub, RobloxMessagingClient, createRedis } from '@enrp/integrations';
import { type ApiEnv } from './env';
import { Metrics } from './lib/metrics';
import { createOAuthClients } from './lib/oauth';
import { type ApiDeps } from './types';

export function createDeps(env: ApiEnv): ApiDeps {
  const logger = createLogger('api', env.LOG_LEVEL);
  const database = createDatabase(env.DATABASE_URL, { max: 20, applicationName: 'enrp-api' });
  const redis = env.REDIS_URL ? createRedis(env.REDIS_URL, 'enrp-api') : undefined;
  const subscriber = env.REDIS_URL ? createRedis(env.REDIS_URL, 'enrp-api-sub') : undefined;
  const bullQueue = redis ? new BullJobQueue(redis) : undefined;
  if (!bullQueue)
    logger.warn(
      'REDIS_URL fehlt: Hintergrundjobs werden nur im Speicher gesammelt und NICHT ausgeführt (nur für lokale Tests).',
    );
  const realtime = new RealtimeHub(redis, subscriber);
  const core: CoreContext = {
    db: database.db,
    now: () => new Date(),
    queue: bullQueue ?? new MemoryQueue(),
    realtime,
    logger,
    discord: env.DISCORD_BOT_TOKEN ? new DiscordRestGateway(env.DISCORD_BOT_TOKEN) : new NotConfiguredDiscordGateway(),
    config: {
      ownerDiscordIds: env.OWNER_DISCORD_IDS,
      hashSecret: env.HASH_SECRET,
      guildId: env.DISCORD_GUILD_ID,
      verifiedRoleId: env.VERIFIED_ROLE_ID,
      appEnv: env.APP_ENV,
    },
  };
  return {
    env,
    database,
    core,
    redis,
    bullQueue,
    realtime,
    metrics: new Metrics(),
    robloxMessaging:
      env.ROBLOX_UNIVERSE_ID && env.ROBLOX_OPEN_CLOUD_KEY
        ? new RobloxMessagingClient(env.ROBLOX_UNIVERSE_ID, env.ROBLOX_OPEN_CLOUD_KEY)
        : undefined,
    oauth: createOAuthClients({
      discordClientId: env.DISCORD_CLIENT_ID,
      discordClientSecret: env.DISCORD_CLIENT_SECRET,
      robloxClientId: env.ROBLOX_CLIENT_ID,
      robloxClientSecret: env.ROBLOX_CLIENT_SECRET,
    }),
  };
}
