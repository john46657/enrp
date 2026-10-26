import { z } from 'zod';

export const appEnvironments = ['development', 'staging', 'production'] as const;
export type AppEnvironment = (typeof appEnvironments)[number];

/** Leere Strings in .env-Dateien wie "nicht gesetzt" behandeln. */
export const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

export const booleanFromString = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', ''])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(appEnvironments).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Ungültige Umgebungsvariablen:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Validiert Umgebungsvariablen. Fehlermeldungen nennen nur Variablennamen,
 * niemals deren Werte, damit keine Geheimnisse in Logs landen.
 */
export function parseEnv<T extends z.ZodType>(schema: T, source: Record<string, string | undefined> = process.env): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`));
  }
  return result.data;
}

/** Produktionsspezifische Plausibilitätsprüfungen. */
export function assertProductionSafety(env: { APP_ENV: AppEnvironment }, checks: Array<[boolean, string]>): void {
  if (env.APP_ENV !== 'production') return;
  const problems = checks.filter(([ok]) => !ok).map(([, msg]) => msg);
  if (problems.length) throw new EnvValidationError(problems);
}
