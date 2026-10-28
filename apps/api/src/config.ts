import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { DatabaseConfig } from './db/database.js';

/** Standardort der lokalen Entwicklungsdatenbank: apps/api/.data/pglite (nicht im Git). */
const DEFAULT_PGLITE_DIR = fileURLToPath(new URL('../.data/pglite', import.meta.url));

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((value) => value === 'true' || value === '1');

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
  };
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
