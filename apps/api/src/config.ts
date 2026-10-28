import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { DatabaseConfig } from './db/database.js';

/** Standardort der lokalen Entwicklungsdatenbank: apps/api/.data/pglite (nicht im Git). */
const DEFAULT_PGLITE_DIR = fileURLToPath(new URL('../.data/pglite', import.meta.url));

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((value) => value === 'true' || value === '1');

// Leere Werte aus der .env (z. B. "DISCORD_CLIENT_ID=") zählen als "nicht gesetzt".
const optionalText = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

const SNOWFLAKE = /^[0-9]{17,20}$/;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Railway & Co. setzen PORT; API_PORT hat Vorrang, falls beide gesetzt sind.
  API_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Kommagetrennte Liste erlaubter Browser-Ursprünge, z. B. "http://localhost:3000".
  CORS_ORIGINS: z.string().default(''),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  // Nur aktivieren, wenn die API hinter einem vertrauenswürdigen Reverse-Proxy läuft.
  TRUST_PROXY: booleanFromEnv,
  // Verbindungs-URL zu PostgreSQL. Leer = lokale Entwicklungsdatenbank (PGlite), in Produktion Pflicht.
  DATABASE_URL: z.string().optional(),
  PGLITE_DATA_DIR: z.string().min(1).optional(),
  // Öffentliche Adresse des Control Centers im Browser – Grundlage für Discord-Weiterleitung und Cookies.
  DASHBOARD_PUBLIC_URL: optionalText,
  // Discord-Anmeldung (Developer Portal → OAuth2). Beide leer = Anmeldung noch nicht eingerichtet.
  DISCORD_CLIENT_ID: optionalText,
  DISCORD_CLIENT_SECRET: optionalText,
  // Nur für automatische Tests mit einer Discord-Attrappe; in Produktion nicht erlaubt.
  DISCORD_OAUTH_BASE_URL: optionalText,
  // Ersteinrichtung: Diese Discord-ID wird Owner, solange es noch keinen Owner gibt.
  OWNER_DISCORD_USER_ID: optionalText,
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(15).max(1440).default(240),
  SESSION_MAX_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(30).max(3650).default(365),
});

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: string;
  corsOrigins: string[];
  rateLimit: { max: number; windowMs: number };
  trustProxy: boolean;
  database: DatabaseConfig;
  /** Ursprung des Dashboards, z. B. "http://127.0.0.1:3000" – ohne Pfad. */
  dashboardOrigin: string;
  /** null = Discord-Anmeldung nicht eingerichtet. */
  discord: { clientId: string; clientSecret: string; baseUrl: string } | null;
  ownerDiscordUserId: string | null;
  session: { idleMinutes: number; maxHours: number };
  auditRetentionDays: number;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Liest und prüft die Umgebungsvariablen. Ungültige Werte führen zu einem klaren Fehler beim Start,
 * statt später zu unerwartetem Verhalten. Fehlermeldungen nennen nur Variablennamen, nie deren Werte.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new ConfigError(`Ungültige Konfiguration:\n  - ${problems.join('\n  - ')}`);
  }
  const e = parsed.data;

  const corsOrigins = e.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    if (origin === '*')
      throw new ConfigError('CORS_ORIGINS: "*" ist nicht erlaubt, bitte konkrete Ursprünge angeben');
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new ConfigError(`CORS_ORIGINS: "${origin}" ist keine gültige URL`);
    }
    if (url.origin !== origin) {
      throw new ConfigError(
        `CORS_ORIGINS: "${origin}" muss ein reiner Ursprung sein (z. B. https://example.org)`,
      );
    }
    if (e.NODE_ENV === 'production' && url.protocol !== 'https:') {
      throw new ConfigError(`CORS_ORIGINS: "${origin}" muss in Produktion HTTPS verwenden`);
    }
  }

  return {
    database: databaseConfig(e.NODE_ENV, e.DATABASE_URL, e.PGLITE_DATA_DIR),
    env: e.NODE_ENV,
    host: e.API_HOST,
    port: e.API_PORT ?? e.PORT ?? 4000,
    logLevel: e.LOG_LEVEL,
    corsOrigins,
    rateLimit: { max: e.RATE_LIMIT_MAX, windowMs: e.RATE_LIMIT_WINDOW_MS },
    trustProxy: e.TRUST_PROXY,
    dashboardOrigin: dashboardOrigin(e.NODE_ENV, e.DASHBOARD_PUBLIC_URL),
    discord: discordConfig(
      e.NODE_ENV,
      e.DISCORD_CLIENT_ID,
      e.DISCORD_CLIENT_SECRET,
      e.DISCORD_OAUTH_BASE_URL,
    ),
    ownerDiscordUserId: ownerId(e.OWNER_DISCORD_USER_ID),
    session: { idleMinutes: e.SESSION_IDLE_MINUTES, maxHours: e.SESSION_MAX_HOURS },
    auditRetentionDays: e.AUDIT_RETENTION_DAYS,
  };
}

function pureOrigin(variable: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${variable}: keine gültige URL (Beispiel: http://127.0.0.1:3000)`);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== value.replace(/\/$/, '')) {
    throw new ConfigError(
      `${variable}: nur Protokoll, Host und Port angeben, ohne Pfad (Beispiel: https://example.org)`,
    );
  }
  return url;
}

function dashboardOrigin(env: AppConfig['env'], value: string | undefined): string {
  if (!value) {
    if (env === 'production') {
      throw new ConfigError(
        'DASHBOARD_PUBLIC_URL: in Produktion erforderlich (öffentliche HTTPS-Adresse des Dashboards)',
      );
    }
    return 'http://127.0.0.1:3000';
  }
  const url = pureOrigin('DASHBOARD_PUBLIC_URL', value);
  if (env === 'production' && url.protocol !== 'https:') {
    throw new ConfigError('DASHBOARD_PUBLIC_URL: muss in Produktion HTTPS verwenden');
  }
  return url.origin;
}

function discordConfig(
  env: AppConfig['env'],
  clientId: string | undefined,
  clientSecret: string | undefined,
  baseUrl: string | undefined,
): AppConfig['discord'] {
  if (baseUrl && env === 'production') {
    throw new ConfigError(
      'DISCORD_OAUTH_BASE_URL: ist nur für Tests gedacht und in Produktion nicht erlaubt',
    );
  }
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) {
    throw new ConfigError(
      'DISCORD_CLIENT_ID und DISCORD_CLIENT_SECRET: bitte beide setzen (oder beide leer lassen)',
    );
  }
  if (!SNOWFLAKE.test(clientId)) {
    throw new ConfigError(
      'DISCORD_CLIENT_ID: muss die Zahl aus dem Discord Developer Portal sein (17–20 Ziffern)',
    );
  }
  // Bewusst ohne den Wert in der Meldung.
  if (clientSecret.length < 16 || /\s/.test(clientSecret)) {
    throw new ConfigError(
      'DISCORD_CLIENT_SECRET: sieht nicht wie ein Client Secret aus (bitte neu kopieren)',
    );
  }
  return {
    clientId,
    clientSecret,
    baseUrl: baseUrl ? pureOrigin('DISCORD_OAUTH_BASE_URL', baseUrl).origin : 'https://discord.com',
  };
}

function ownerId(value: string | undefined): string | null {
  if (!value) return null;
  if (!SNOWFLAKE.test(value)) {
    throw new ConfigError('OWNER_DISCORD_USER_ID: muss eine Discord-Benutzer-ID sein (17–20 Ziffern)');
  }
  return value;
}

function databaseConfig(
  env: AppConfig['env'],
  url: string | undefined,
  pgliteDir: string | undefined,
): DatabaseConfig {
  const trimmed = url?.trim();
  if (trimmed) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      // Bewusst ohne den Wert: Die URL enthält meist ein Passwort.
      throw new ConfigError(
        'DATABASE_URL: keine gültige URL (Format: postgres://BENUTZER:PASSWORT@HOST:5432/DATENBANK)',
      );
    }
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      throw new ConfigError('DATABASE_URL: muss mit postgres:// oder postgresql:// beginnen');
    }
    return { kind: 'postgres', url: trimmed };
  }
  if (env === 'production') {
    throw new ConfigError(
      'DATABASE_URL: in Produktion erforderlich (die lokale Entwicklungsdatenbank ist dort nicht erlaubt)',
    );
  }
  // Tests legen ihre Datenbanken selbst an und brauchen keinen Ordner auf der Festplatte.
  return { kind: 'pglite', dataDir: env === 'test' ? null : (pgliteDir ?? DEFAULT_PGLITE_DIR) };
}
