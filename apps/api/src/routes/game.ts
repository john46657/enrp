import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { game, hasPermission, moderation, requirePermission, type RobloxServerActor } from '@enrp/core';
import { AppError } from '@enrp/shared';
import { idParam, reason, robloxUserId } from './schemas';

const robloxRate = {
  max: 600,
  timeWindow: '1 minute',
  keyGenerator: (req: { headers: Record<string, unknown>; ip: string }) =>
    String(req.headers.authorization ?? req.ip).slice(-24),
};

/** Endpunkte für Roblox-Spielserver (HttpService) und deren Verwaltung im Dashboard. */
export async function gameRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { core } = app.deps;
  const tags = ['Roblox-Spielserver'];
  const asServer = (actor: unknown) => actor as RobloxServerActor;

  app.post(
    '/game/heartbeat',
    {
      schema: { tags, summary: 'Heartbeat mit Spielerliste; liefert Steuerdaten', body: game.heartbeatSchema },
      config: { roblox: true, rateLimit: robloxRate },
    },
    async (request) => game.processHeartbeat(core, asServer(request.actor), request.body),
  );
  app.post(
    '/game/events',
    {
      schema: { tags, summary: 'Spielereignisse (idempotent je Ereignis-ID)', body: game.eventBatchSchema },
      config: { roblox: true, rateLimit: robloxRate },
    },
    async (request) => ({
      results: await game.processGameEvents(core, asServer(request.actor), request.body),
    }),
  );
  app.post(
    '/game/shutdown',
    {
      schema: { tags, summary: 'Server fährt herunter', body: z.object({ jobId: z.string().min(1).max(100) }) },
      config: { roblox: true, rateLimit: robloxRate },
    },
    async (request) => game.processShutdown(core, request.body.jobId),
  );
  app.post(
    '/game/players/access',
    {
      schema: {
        tags,
        summary: 'Zugangsprüfung beim Betreten (Bann, Fraktion, Fahrzeuge)',
        body: z.object({ jobId: z.string().max(100), userId: robloxUserId }),
      },
      config: { roblox: true, rateLimit: robloxRate },
    },
    async (request) => game.playerAccess(core, request.body.userId),
  );
  app.post(
    '/game/redeem',
    {
      schema: { tags, summary: 'Code einlösen (Idempotency-Key-Header erforderlich)', body: game.redeemSchema },
      config: { roblox: true, rateLimit: robloxRate },
    },
    async (request) => {
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string' || !/^[\w{}-]{8,64}$/.test(key))
        throw new AppError('BAD_REQUEST', 'Idempotency-Key-Header fehlt oder ist ungültig.');
      return game.redeemFromGame(core, asServer(request.actor), request.body, key);
    },
  );
  app.post(
    '/game/sanctions/:id/ack',
    {
      schema: {
        tags,
        summary: 'Ausführung einer Roblox-Sanktion bestätigen',
        params: idParam,
        body: z.object({ jobId: z.string().max(100), success: z.boolean(), error: z.string().max(500).optional() }),
      },
      config: { roblox: true, rateLimit: robloxRate },
    },
    async (request) => moderation.acknowledgeRobloxSanction(core, request.actor, request.params.id, request.body),
  );

  app.post(
    '/game/commands/poll',
    {
      schema: { tags, summary: 'Offene Server-Befehle abholen', body: z.object({ jobId: z.string().min(1).max(100) }) },
      config: { roblox: true, rateLimit: robloxRate },
    },
    async (request) => game.pollServerCommands(core, asServer(request.actor), request.body.jobId),
  );
  app.post(
    '/game/commands/:id/ack',
    {
      schema: {
        tags,
        summary: 'Ausführung eines Server-Befehls bestätigen',
        params: idParam,
        body: z.object({ jobId: z.string().max(100), success: z.boolean(), error: z.string().max(500).optional() }),
      },
      config: { roblox: true, rateLimit: robloxRate },
    },
    async (request) => game.acknowledgeServerCommand(core, asServer(request.actor), request.params.id, request.body),
  );

  // Verwaltung
  const atags = ['Roblox-Verwaltung'];
  app.get(
    '/roblox/servers/:id',
    { schema: { tags: atags, summary: 'Server-Details mit Spielerliste und Befehlen', params: idParam } },
    async (request) => {
      requirePermission(request.actor, 'roblox_servers:view');
      return game.getServerDetail(core.db, request.params.id);
    },
  );
  app.post(
    '/roblox/commands',
    {
      schema: {
        tags: atags,
        summary: 'Befehl an einen oder alle laufenden Server (Nachricht, Herunterfahren)',
        body: z.object({
          serverId: z.uuid().optional(),
          command: game.serverCommandSchema,
          reason,
        }),
      },
    },
    async (request) => {
      const { serverId, command } = request.body;
      const result = await game.createServerCommand(
        core,
        request.actor,
        serverId ? { serverId } : { allOnline: true },
        command,
        request.body.reason,
      );
      // Weckruf ist nur eine Beschleunigung; Fehler ändern nichts an der Zustellung per Abholen.
      app.deps.robloxMessaging
        ?.publish('ENRP_Commands', JSON.stringify({ serverIds: result.items.map((c) => c.serverId) }))
        .catch((err: Error) => request.log.warn({ err: err.message }, 'Open-Cloud-Weckruf fehlgeschlagen'));
      return result;
    },
  );
  app.get(
    '/roblox/commands',
    {
      schema: {
        tags: atags,
        summary: 'Letzte Server-Befehle',
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
      },
    },
    async (request) => {
      requirePermission(request.actor, 'roblox_servers:view');
      return { items: await game.listServerCommands(core.db, undefined, request.query.limit) };
    },
  );
  app.get('/roblox/servers', { schema: { tags: atags, summary: 'Serverstatus und -historie' } }, async (request) => {
    if (!hasPermission(request.actor, 'roblox_servers:view')) requirePermission(request.actor, 'monitoring:view');
    return { overview: await game.serverOverview(core.db, core.now()), recent: await game.listServers(core.db, 50) };
  });
  app.get('/roblox/keys', { schema: { tags: atags, summary: 'API-Schlüssel (ohne Klartext)' } }, async (request) => {
    requirePermission(request.actor, 'roblox_servers:view');
    return { items: await game.listRobloxApiKeys(core.db) };
  });
  app.post(
    '/roblox/keys',
    {
      schema: {
        tags: atags,
        summary: 'API-Schlüssel erzeugen (Klartext nur einmal)',
        body: z.object({
          name: z.string().min(2).max(60),
          allowedPlaceIds: z
            .array(z.string().regex(/^\d{1,20}$/))
            .max(20)
            .optional(),
          reason,
        }),
      },
    },
    async (request) =>
      game.createRobloxApiKey(
        core,
        request.actor,
        { name: request.body.name, allowedPlaceIds: request.body.allowedPlaceIds },
        request.body.reason,
      ),
  );
  app.post(
    '/roblox/keys/:id/revoke',
    { schema: { tags: atags, summary: 'API-Schlüssel widerrufen', params: idParam, body: z.object({ reason }) } },
    async (request) => game.revokeRobloxApiKey(core, request.actor, request.params.id, request.body.reason),
  );
  app.get(
    '/roblox/events',
    {
      schema: {
        tags: atags,
        summary: 'Letzte Spielereignisse',
        querystring: z.object({
          type: z.string().max(40).optional(),
          status: z.string().max(20).optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
      },
    },
    async (request) => {
      requirePermission(request.actor, 'roblox_servers:view');
      return { items: await game.recentGameEvents(core.db, request.query) };
    },
  );
}
