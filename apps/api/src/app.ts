import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { ReadinessCheck } from '@emden/shared';
import type { AppConfig } from './config.js';
import { registerErrorHandling } from './errors.js';
import { healthRoutes } from './routes/health.js';
import { version } from './version.js';

export interface BuildAppOptions {
  readinessChecks?: () => Promise<ReadinessCheck[]>;
}

// Bis Phase 2 gibt es keine Datenbank – das wird ehrlich als "nicht konfiguriert" gemeldet.
const defaultReadinessChecks = async (): Promise<ReadinessCheck[]> => [
  { name: 'database', status: 'not_configured', message: 'PostgreSQL wird in Phase 2 angebunden.' },
];

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export async function buildApp(config: AppConfig, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: 64 * 1024,
    // false: Fastify übernimmt den Header nicht selbst, sondern genReqId prüft ihn.
    requestIdHeader: false,
    // Fremde Request-IDs nur übernehmen, wenn sie harmlos aussehen (kein Log-Injection-Risiko).
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    },
    logger:
      config.env === 'test'
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'],
              censor: '[entfernt]',
            },
            ...(config.env === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
          },
  });

  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });

  await app.register(helmet, {
    // Reine JSON-API: keine Skripte, keine Einbettung in fremde Seiten.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });
  await app.register(cors, {
    // Leere Liste = Browser von fremden Ursprüngen werden nicht zugelassen (sicherer Standard).
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
  });

  registerErrorHandling(app);

  await app.register(healthRoutes, {
    version,
    readinessChecks: options.readinessChecks ?? defaultReadinessChecks,
  });

  return app;
}
