import { type Actor, type CoreContext } from '@enrp/core';
import { type DatabaseHandle } from '@enrp/database';
import { type BullJobQueue, type RealtimeHub, type RobloxMessagingClient } from '@enrp/integrations';
import { type Redis } from 'ioredis';
import { type ApiEnv } from './env';
import { type OAuthClients } from './lib/oauth';
import { type Metrics } from './lib/metrics';

export interface ApiDeps {
  env: ApiEnv;
  database: DatabaseHandle;
  core: CoreContext;
  oauth: OAuthClients;
  realtime: RealtimeHub;
  metrics: Metrics;
  redis?: Redis;
  bullQueue?: BullJobQueue;
  robloxMessaging?: RobloxMessagingClient;
}

export interface SessionInfo {
  id: string;
  discordUserId: string;
  csrfToken: string;
  expiresAt: Date;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: ApiDeps;
  }
  interface FastifyRequest {
    actor: Actor;
    authMethod: 'session' | 'bot' | 'roblox' | 'none';
    session?: SessionInfo;
  }
  interface FastifyContextConfig {
    /** Schreibende Anfragen mit Idempotency-Key-Header werden dedupliziert. */
    idempotent?: boolean;
    /** Nur über Roblox-Server-Schlüssel erreichbar. */
    roblox?: boolean;
    /** Eigene Authentifizierung (z. B. /metrics mit METRICS_TOKEN). */
    skipAuth?: boolean;
  }
}
