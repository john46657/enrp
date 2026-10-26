import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { hasPermission, REALTIME_TOPICS, type RealtimeTopic } from '@enrp/core';
import { AppError } from '@enrp/shared';
import { requireAuthenticated } from '../plugins/auth';

const TOPIC_PERMISSION: Record<RealtimeTopic, string> = {
  servers: 'monitoring:view',
  tickets: 'tickets:view',
  reports: 'reports:view',
  alerts: 'monitoring:view',
  jobs: 'jobs:view',
  incidents: 'incidents:view',
  approvals: 'approvals:view',
};
const MAX_PER_USER = 3;
const MAX_TOTAL = 200;
const perUser = new Map<string, number>();
let total = 0;

/**
 * Server-Sent Events für Live-Daten. Nur angemeldete Personen, Themen werden nach Berechtigung gefiltert,
 * Verbindungen sind begrenzt; der Browser verbindet sich bei Abbruch automatisch neu (retry).
 */
export async function realtimeRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/realtime/stream',
    { schema: { tags: ['Echtzeit'], summary: 'Live-Ereignisse (SSE)', querystring: z.object({ topics: z.string().max(200).optional() }) }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      requireAuthenticated(request);
      const userId = (request.actor as { discordUserId: string }).discordUserId;
      const requested = (request.query.topics?.split(',') ?? [...REALTIME_TOPICS]).filter((t): t is RealtimeTopic => (REALTIME_TOPICS as readonly string[]).includes(t));
      const topics = new Set(requested.filter((t) => hasPermission(request.actor, TOPIC_PERMISSION[t])));
      if (!topics.size) throw new AppError('FORBIDDEN', 'Keine Berechtigung für die angefragten Live-Daten.');
      if ((perUser.get(userId) ?? 0) >= MAX_PER_USER || total >= MAX_TOTAL) throw new AppError('RATE_LIMITED', 'Zu viele Live-Verbindungen.');

      perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
      total++;
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`retry: 5000\n\nevent: ready\ndata: ${JSON.stringify({ topics: [...topics] })}\n\n`);
      const unsubscribe = app.deps.realtime.subscribe((message) => {
        if (!topics.has(message.topic)) return;
        res.write(`event: ${message.topic}\ndata: ${JSON.stringify(message)}\n\n`);
      });
      const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);
      // Sitzungen laufen ab – Verbindung spätestens nach 30 Minuten schließen, der Client verbindet neu.
      const maxLifetime = setTimeout(() => res.end(), 30 * 60_000);
      const cleanup = () => {
        clearInterval(keepAlive);
        clearTimeout(maxLifetime);
        unsubscribe();
        perUser.set(userId, Math.max(0, (perUser.get(userId) ?? 1) - 1));
        total = Math.max(0, total - 1);
      };
      request.raw.on('close', cleanup);
    },
  );
}
