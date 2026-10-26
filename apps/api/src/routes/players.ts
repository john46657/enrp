import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, robloxUserId, snowflake } from '@emden-network/shared';
import { getProfile, type VerificationService } from '@emden-network/core';
import type { Pool } from '@emden-network/database';
import { bearerMatches } from '../auth.js';
import { parse } from '../validation.js';

export interface PlayerRouteOptions {
  pool: Pool;
  verification: VerificationService;
  internalApiToken: string;
  gameApiKey: string;
}

export async function playerRoutes(app: FastifyInstance, opts: PlayerRouteOptions) {
  /**
   * Profil abrufen. Erlaubt für interne Dienste (INTERNAL_API_TOKEN) und Spielserver (GAME_API_KEY,
   * z. B. um Fraktion/Rang beim Beitritt zu prüfen). `:id` ist `discord:<id>` oder `roblox:<id>`.
   */
  app.get('/v1/players/:id/profile', async (req, reply) => {
    if (!bearerMatches(req, opts.internalApiToken) && !bearerMatches(req, opts.gameApiKey)) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Ungültige oder fehlende Authentifizierung.' });
    }
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const [kind, value] = id.split(':');
    let by: { discordId: string } | { robloxUserId: string };
    if (kind === 'discord') by = { discordId: parse(snowflake, value) };
    else if (kind === 'roblox') by = { robloxUserId: parse(robloxUserId, value) };
    else throw new AppError('VALIDATION', 400, 'id muss discord:<id> oder roblox:<id> sein');
    const profile = await getProfile(opts.pool, by);
    if (!profile || !profile.roblox) throw new AppError('NOT_LINKED', 404);
    return profile;
  });

  /** Verknüpfung aufheben – nur für interne Dienste, die den Auslöser selbst authentifiziert und autorisiert haben. */
  app.post('/v1/verification/revoke', async (req, reply) => {
    if (!bearerMatches(req, opts.internalApiToken)) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Ungültige oder fehlende Authentifizierung.' });
    }
    const body = parse(
      z.object({ discordId: snowflake, guildId: snowflake, actorDiscordId: snowflake, reason: z.string().min(3).max(300) }),
      req.body,
    );
    const r = await opts.verification.revokeLink(body);
    return { ok: true, robloxUserId: r.robloxUserId };
  });
}
