import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, actionResultSchema, gameEventsBatchSchema, heartbeatSchema, jobIdSchema } from '@emden-network/shared';
import type { GameService } from '@emden-network/core';
import { requireBearer } from '../auth.js';
import { parse } from '../validation.js';

export interface GameRouteOptions {
  game: GameService;
  gameApiKey: string;
  allowedPlaceIds: ReadonlySet<number>;
}

/**
 * Game-API für serverseitige Roblox-Skripte. Authentifizierung: `Authorization: Bearer <GAME_API_KEY>`,
 * der Schlüssel liegt ausschließlich in den Roblox-Experience-Secrets (HttpService:GetSecret).
 */
export async function gameRoutes(app: FastifyInstance, opts: GameRouteOptions) {
  app.addHook('onRequest', requireBearer(opts.gameApiKey));
  const limit = { config: { rateLimit: { max: 240, timeWindow: '1 minute', keyGenerator: (req: { ip: string; headers: Record<string, unknown> }) => `${req.ip}:${String(req.headers['roblox-job-id'] ?? '')}` } } };

  app.post('/v1/game/heartbeat', limit, async (req) => {
    const hb = parse(heartbeatSchema, req.body);
    if (opts.allowedPlaceIds.size > 0 && !opts.allowedPlaceIds.has(hb.placeId)) throw new AppError('FORBIDDEN', 403, `placeId ${hb.placeId} nicht erlaubt`);
    const { settings } = await opts.game.heartbeat(hb);
    return { ok: true, settings, nextHeartbeatSeconds: 30 };
  });

  app.post('/v1/game/events', limit, async (req) => {
    const batch = parse(gameEventsBatchSchema, req.body);
    const results = await opts.game.ingestEvents(batch.jobId, batch.events);
    return { results };
  });

  app.get('/v1/game/actions', limit, async (req) => {
    const { jobId } = parse(z.object({ jobId: jobIdSchema }), req.query);
    const jobs = await opts.game.pollJobs(jobId);
    return { actions: jobs.map((j) => ({ id: j.id, type: j.type, payload: j.payload, expiresAt: j.expiresAt.toISOString() })) };
  });

  app.post('/v1/game/actions/:id/result', limit, async (req) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const body = parse(actionResultSchema, req.body);
    const r = await opts.game.reportResult(body.jobId, id, body.success, body.message);
    return { ok: true, status: r.status, duplicate: r.duplicate };
  });
}

/** Öffentlicher, aggregierter Serverstatus ohne personenbezogene Daten. */
export async function publicStatusRoutes(app: FastifyInstance, opts: { game: GameService }) {
  app.get('/v1/servers/status', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (_req, reply) => {
    const s = await opts.game.status();
    reply.header('cache-control', 'public, max-age=15');
    return { servers: s.servers, players: s.players, maintenance: s.maintenance.enabled };
  });
}
