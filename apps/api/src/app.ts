import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { AppError } from '@emden-network/shared';
import type { Pool } from '@emden-network/database';
import { GameService, type VerificationService } from '@emden-network/core';
import { authRobloxRoutes } from './routes/auth-roblox.js';
import { gameRoutes, publicStatusRoutes } from './routes/game.js';
import { playerRoutes } from './routes/players.js';

export interface AppDeps {
  pool: Pool;
  verification: VerificationService;
  cookieSecure: boolean;
  internalApiToken: string;
  gameApiKey: string;
  allowedPlaceIds: ReadonlySet<number>;
  trustProxy?: string | undefined;
  logger?: FastifyServerOptions['logger'];
  /** Für Tests: Rate-Limits deaktivieren */
  disableRateLimit?: boolean;
}

/** Entfernt Query-Strings aus geloggten URLs (enthalten state/code/Start-Token). */
export function stripQuery(url: string): string {
  const i = url.indexOf('?');
  return i === -1 ? url : `${url.slice(0, i)}?[entfernt]`;
}

/** TRUST_PROXY: "true", Anzahl Hops (z. B. "1") oder IP/CIDR-Liste ("10.0.0.0/8,127.0.0.1"). */
function parseTrustProxy(v: string | undefined): FastifyServerOptions['trustProxy'] {
  if (v === undefined || v === '') return undefined;
  if (v === 'true') return true;
  // Fastify akzeptiert eine Hop-Anzahl zur Laufzeit, die Typen kennen nur string/boolean/Funktion.
  if (/^\d+$/.test(v)) return Number(v) as unknown as string;
  return v.split(',').map((s) => s.trim());
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  // Logger-Konfiguration (Redaction, Serializer ohne Query-Strings) wird vom Aufrufer übergeben, siehe main.ts.
  const trustProxy = parseTrustProxy(deps.trustProxy);
  const app: FastifyInstance = Fastify({
    logger: deps.logger ?? false,
    ...(trustProxy !== undefined ? { trustProxy } : {}),
    bodyLimit: 64 * 1024,
    
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        styleSrc: ["'unsafe-inline'"],
        imgSrc: ["'self'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  });
  await app.register(cookie);
  if (!deps.disableRateLimit) {
    await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  }

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      if (err.internalDetail) req.log.info({ code: err.code, detail: err.internalDetail }, 'Fachlicher Fehler');
      return reply.code(err.httpStatus).send({ error: err.code, message: err.userMessage });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: status === 429 ? 'TOO_MANY_ATTEMPTS' : 'BAD_REQUEST', message: status === 429 ? 'Zu viele Anfragen.' : 'Ungültige Anfrage.' });
    }
    req.log.error({ err: { name: (err as Error).name, message: (err as Error).message, stack: (err as Error).stack } }, 'Unbehandelter Fehler');
    return reply.code(500).send({ error: 'INTERNAL', message: 'Interner Fehler.' });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'NOT_FOUND', message: 'Nicht gefunden.' }));

  app.get('/healthz', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  app.get('/readyz', { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await deps.pool.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  const game = new GameService(deps.pool);
  await app.register(authRobloxRoutes, { verification: deps.verification, cookieSecure: deps.cookieSecure });
  await app.register(publicStatusRoutes, { game });
  await app.register(playerRoutes, { pool: deps.pool, verification: deps.verification, internalApiToken: deps.internalApiToken, gameApiKey: deps.gameApiKey });
  // Eigener Kontext, damit der Auth-Hook nur für /v1/game/* gilt.
  await app.register(gameRoutes, { game, gameApiKey: deps.gameApiKey, allowedPlaceIds: deps.allowedPlaceIds });
  return app;
}
