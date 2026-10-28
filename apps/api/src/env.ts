import { z } from 'zod';
import { assertProductionSafety, baseEnvSchema, booleanFromString, csv, optionalString, parseEnv } from '@enrp/config';

export const apiEnvSchema = baseEnvSchema.extend({
  DATABASE_URL: z.string().url(),
  REDIS_URL: optionalString,
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** Öffentliche Basis-URL, unter der /api erreichbar ist (für OAuth-Redirects). */
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  /** URL des Dashboards (Weiterleitung nach dem Login, CORS). */
  DASHBOARD_URL: z.string().url().default('http://localhost:3000'),
  TRUST_PROXY: booleanFromString.default(false),
  COOKIE_SECURE: booleanFromString.optional(),
  BOT_API_TOKEN: z.string().min(32, 'BOT_API_TOKEN muss mindestens 32 Zeichen lang sein'),
  HASH_SECRET: z.string().min(32, 'HASH_SECRET muss mindestens 32 Zeichen lang sein'),
  OWNER_DISCORD_IDS: csv,
  DISCORD_CLIENT_ID: optionalString,
  DISCORD_CLIENT_SECRET: optionalString,
  DISCORD_BOT_TOKEN: optionalString,
  DISCORD_GUILD_ID: optionalString,
  VERIFIED_ROLE_ID: optionalString,
  ROBLOX_CLIENT_ID: optionalString,
  ROBLOX_CLIENT_SECRET: optionalString,
  METRICS_TOKEN: optionalString,
  RELEASE_WEBHOOK_SECRET: optionalString,
  APP_VERSION: z.string().default('0.0.0-dev'),
  BODY_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(10 * 1024 * 1024)
    .default(256 * 1024),
  ENABLE_API_DOCS: booleanFromString.optional(),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  const env = parseEnv(apiEnvSchema, source);
  assertProductionSafety(env, [
    [env.PUBLIC_URL.startsWith('https://'), 'PUBLIC_URL muss in Produktion HTTPS verwenden'],
    [env.DASHBOARD_URL.startsWith('https://'), 'DASHBOARD_URL muss in Produktion HTTPS verwenden'],
    [env.COOKIE_SECURE !== false, 'COOKIE_SECURE darf in Produktion nicht deaktiviert sein'],
    [Boolean(env.REDIS_URL), 'REDIS_URL ist in Produktion erforderlich (Rate-Limits, Warteschlangen)'],
    [env.OWNER_DISCORD_IDS.length > 0, 'OWNER_DISCORD_IDS muss mindestens eine Discord-ID enthalten'],
  ]);
  return env;
}
