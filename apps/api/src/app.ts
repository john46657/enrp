import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { ReadinessCheck } from '@emden/shared';
import { cookieSettings, type CookieSettings } from './auth/cookies.js';
import { authenticate } from './auth/guards.js';
import { createDiscordOAuth, type DiscordOAuth } from './auth/discord.js';
import type { AppConfig } from './config.js';
import type { DatabaseHandle } from './db/database.js';
import { databaseReadiness } from './db/readiness.js';
import { registerErrorHandling } from './errors.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { registerOriginCheck } from './security/origin-check.js';
import { version } from './version.js';

export interface BuildAppOptions {
  /** Datenbank; ohne sie laufen nur die Health-Endpunkte (z. B. in reinen HTTP-Tests). */
  db?: DatabaseHandle;
  readinessChecks?: () => Promise<ReadinessCheck[]>;
  /** Discord-Anbindung; Standard: aus der Konfiguration. Tests setzen hier eine Attrappe ein. */
  discord?: DiscordOAuth | null;
  /** Uhr; Tests können die Zeit damit steuern. */
  clock?: () => Date;
}

const withoutDatabase = async (): Promise<ReadinessCheck[]> => [
  { name: 'database', status: 'not_configured', message: 'Keine Datenbank angebunden.' },
];

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
/** Angemeldete Personen dürfen ein Vielfaches an Anfragen stellen (eine Dashboard-Seite = mehrere Anfragen). */
const AUTHENTICATED_RATE_FACTOR = 6;

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
  await app.register(cookie);

  registerErrorHandling(app);
  registerOriginCheck(app, [config.dashboardOrigin, ...config.corsOrigins]);

  app.decorate('appConfig', config);
  app.decorate('clock', options.clock ?? (() => new Date()));
  app.decorate('cookieSettings', cookieSettings(config.dashboardOrigin));

  const { db } = options;
  if (db) {
    // Sitzung früh erkennen, damit das Rate Limit angemeldete Personen getrennt zählen kann.
    app.addHook('onRequest', async (request) => {
      if (request.cookies[app.cookieSettings.session]) await authenticate(request);
    });
  }

  // Das Dashboard spricht die API über seinen eigenen Server an – alle Besucher kämen von dessen Adresse.
  // Daher: Angemeldete Anfragen zählen pro Sitzung (nur vom Backend ausgestellte, also nicht fälschbar),
  // alle anderen pro IP-Adresse. Die Prüfung hängt an den Routen, also nach den globalen Hooks oben.
  await app.register(rateLimit, {
    keyGenerator: (request) => (request.auth ? `session:${request.auth.sessionId}` : `ip:${request.ip}`),
    max: (request) =>
      request.auth ? config.rateLimit.max * AUTHENTICATED_RATE_FACTOR : config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
  });

  if (db) {
    // Die Verbindung gehört dem Aufrufer (server.ts schließt sie).
    app.decorate('db', db);
    const discord =
      options.discord !== undefined ? options.discord : config.discord && createDiscordOAuth(config.discord);
    await app.register(authRoutes, { discord });
    await app.register(adminRoutes);
  }

  await app.register(healthRoutes, {
    version,
    readinessChecks:
      options.readinessChecks ??
      (db
        ? async () => [
            await databaseReadiness(db, (err) => app.log.error({ err }, 'Datenbankprüfung fehlgeschlagen')),
          ]
        : withoutDatabase),
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: DatabaseHandle;
    appConfig: AppConfig;
    clock: () => Date;
    cookieSettings: CookieSettings;
  }
}
