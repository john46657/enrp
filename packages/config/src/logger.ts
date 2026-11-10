import pino, { type Logger, type LoggerOptions } from 'pino';

/**
 * Pfade, die niemals im Klartext geloggt werden. Pino ersetzt sie durch "[redacted]".
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-bot-token"]',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.access_token',
  '*.refresh_token',
  '*.clientSecret',
  '*.client_secret',
  '*.code_verifier',
  '*.codeVerifier',
  '*.secret',
  '*.apiKey',
];

export function createLogger(
  name: string,
  level: string = process.env.LOG_LEVEL ?? 'info',
  options: LoggerOptions = {},
): Logger {
  return pino({
    name,
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { service: name, env: process.env.APP_ENV ?? 'development' },
    ...options,
  });
}

export type { Logger };
