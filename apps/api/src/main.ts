import { createPool } from '@emden-network/database';
import { RobloxOAuthClient, VerificationService } from '@emden-network/core';
import { buildApp, stripQuery } from './app.js';
import { loadConfig, redirectUri } from './config.js';

const cfg = loadConfig();
const pool = createPool({ connectionString: cfg.DATABASE_URL, applicationName: 'emden-network-api' });

const oauth = new RobloxOAuthClient({
  clientId: cfg.ROBLOX_OAUTH_CLIENT_ID,
  clientSecret: cfg.ROBLOX_OAUTH_CLIENT_SECRET,
  redirectUri: redirectUri(cfg),
  ...(cfg.ROBLOX_OAUTH_BASE_URL ? { baseUrl: cfg.ROBLOX_OAUTH_BASE_URL } : {}),
});

const app = await buildApp({
  pool,
  verification: new VerificationService(pool, oauth, { publicBaseUrl: cfg.PUBLIC_BASE_URL }),
  cookieSecure: cfg.COOKIE_SECURE,
  internalApiToken: cfg.INTERNAL_API_TOKEN,
  gameApiKey: cfg.GAME_API_KEY,
  allowedPlaceIds: cfg.ALLOWED_PLACE_IDS,
  trustProxy: cfg.TRUST_PROXY,
  logger: {
    level: cfg.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    serializers: {
      req: (req: { method: string; url: string; id: string }) => ({ id: req.id, method: req.method, url: stripQuery(req.url) }),
    },
  },
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Fahre herunter');
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: cfg.HOST, port: cfg.PORT });
