import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { REDACT_PATHS } from '@enrp/config';
import { requestContext } from '@enrp/core';
import { type ApiDeps } from './types';
import { registerAuth } from './plugins/auth';
import { registerErrorHandling } from './plugins/errors';
import { registerIdempotency } from './plugins/idempotency';
import { registerRobloxAuth } from './plugins/roblox-auth';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { botRoutes } from './routes/bot';
import { communityRoutes } from './routes/community';
import { gameRoutes } from './routes/game';
import { opsRoutes } from './routes/ops';
import { realtimeRoutes } from './routes/realtime';
import { supportRoutes } from './routes/support';
import { verificationRoutes } from './routes/verification';
import { worldRoutes } from './routes/world';
import { healthReport } from './lib/health';
import { safeEqual } from '@enrp/core';

export async function buildApp(deps: ApiDeps, options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const { env } = deps;
  const app = Fastify({
    logger: options.logger === false ? false : { level: env.LOG_LEVEL, redact: { paths: REDACT_PATHS, censor: '[redacted]' } },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: env.BODY_LIMIT_BYTES,
    genReqId: () => randomUUID(),
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);

  app.addHook('onRequest', (request, reply, done) => {
    reply.header('x-request-id', request.id);
    requestContext.run({ requestId: request.id }, done);
  });
  app.addHook('onResponse', (request, reply, done) => {
    deps.metrics.record(`${request.method} ${request.routeOptions.url ?? 'unbekannt'}`, reply.statusCode, reply.elapsedTime);
    done();
  });

  registerErrorHandling(app);
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], frameAncestors: ["'none'"] } },
    hsts: env.APP_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  await app.register(cookie);
  await app.register(cors, { origin: [new URL(env.DASHBOARD_URL).origin], credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    redis: deps.redis,
    nameSpace: 'enrp-rl:',
    // Der Bot bündelt viele Nutzer – er wird pro handelnder Person begrenzt, nicht pro IP.
    keyGenerator: (request) => (typeof request.headers['x-actor-id'] === 'string' ? `actor:${request.headers['x-actor-id']}` : request.ip),
    errorResponseBuilder: (request, context) => ({ statusCode: 429, error: { code: 'RATE_LIMITED', message: `Zu viele Anfragen. Bitte in ${Math.ceil(context.ttl / 1000)} s erneut versuchen.`, requestId: request.id } }),
  });

  const docsEnabled = env.ENABLE_API_DOCS ?? env.APP_ENV !== 'production';
  await app.register(swagger, {
    openapi: {
      info: { title: 'ENRP GermanRP API', version: env.APP_VERSION, description: 'Versionierte REST-API für Dashboard, Discord-Bot und Roblox-Spielserver. Fehlerformat: { error: { code, message, requestId, details? } }.' },
      servers: [{ url: env.PUBLIC_URL }],
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: 'enrp_session', description: 'Dashboard-Sitzung; Schreibzugriffe zusätzlich mit X-CSRF-Token' },
          service: { type: 'http', scheme: 'bearer', description: 'Bot-Service-Token; handelnde Person über X-Actor-Id/X-Actor-Roles' },
          roblox: { type: 'http', scheme: 'bearer', description: 'Roblox-Server-Schlüssel + X-Roblox-Timestamp + X-Roblox-Nonce' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  if (docsEnabled) await app.register(swaggerUi, { routePrefix: '/api/docs' });

  registerAuth(app);
  registerRobloxAuth(app);
  registerIdempotency(app);

  // Öffentliche Health-Checks für Load-Balancer/Container (ohne Details).
  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  app.get('/health/ready', { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await deps.database.ping();
      if (deps.redis) await deps.redis.ping();
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({ status: 'not_ready' });
    }
  });
  app.get('/metrics', { config: { rateLimit: false, skipAuth: true } }, async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer /, '');
    if (!env.METRICS_TOKEN || !token || !safeEqual(token, env.METRICS_TOKEN)) return reply.status(404).send();
    reply.type('text/plain; version=0.0.4');
    return deps.metrics.prometheus();
  });

  await app.register(
    async (v1) => {
      await v1.register(authRoutes);
      await v1.register(verificationRoutes);
      await v1.register(worldRoutes);
      await v1.register(supportRoutes);
      await v1.register(communityRoutes);
      await v1.register(gameRoutes);
      await v1.register(adminRoutes);
      await v1.register(opsRoutes);
      await v1.register(realtimeRoutes);
      await v1.register(botRoutes);
      v1.get('/status', { schema: { tags: ['Monitoring'], summary: 'Öffentlicher Status (aggregiert)' } }, async () => {
        const report = await healthReport(deps);
        return { status: report.status, roblox: report.roblox ? { connected: report.roblox.connected, playersOnline: report.roblox.playersOnline } : null };
      });
    },
    { prefix: '/api/v1' },
  );
  return app;
}
