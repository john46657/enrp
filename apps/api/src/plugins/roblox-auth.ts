import { type FastifyInstance } from 'fastify';
import { game, recordSecurityEvent } from '@enrp/core';
import { AppError } from '@enrp/shared';

/**
 * Authentifizierung der Spielserver: Bearer-Schlüssel (Roblox Secrets Store), X-Roblox-Timestamp,
 * X-Roblox-Nonce. Fehler werden als Sicherheitsereignis protokolliert – ohne Schlüssel.
 */
export function registerRobloxAuth(app: FastifyInstance) {
  app.addHook('preHandler', async (request) => {
    if (!request.routeOptions.config.roblox) return;
    const { core } = app.deps;
    const header = request.headers.authorization;
    const body = (request.body ?? {}) as { placeId?: string; jobId?: string };
    try {
      const { apiKeyId } = await game.authenticateRobloxRequest(
        core.db,
        {
          bearer: header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined,
          timestamp: request.headers['x-roblox-timestamp'] as string | undefined,
          nonce: request.headers['x-roblox-nonce'] as string | undefined,
          placeId: (request.headers['x-roblox-place-id'] as string | undefined) ?? body.placeId ?? null,
        },
        core.now(),
      );
      request.authMethod = 'roblox';
      request.actor = { kind: 'roblox_server', apiKeyId, jobId: body.jobId };
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'INTERNAL';
      await recordSecurityEvent(core.db, core.config.hashSecret, {
        type: `roblox.${code.toLowerCase()}`,
        severity: code === 'REPLAY_DETECTED' ? 'critical' : 'warning',
        ip: request.ip,
        details: { path: request.routeOptions.url },
      });
      throw err;
    }
  });
}
