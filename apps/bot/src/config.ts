import { z } from 'zod';

const snowflake = z.string().regex(/^[0-9]{17,20}$/);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DISCORD_TOKEN: z.string().min(50, 'DISCORD_TOKEN fehlt oder ist ungültig'),
  DISCORD_APPLICATION_ID: snowflake,
  DISCORD_GUILD_ID: snowflake,
  DATABASE_URL: z.string().url(),
  /** Öffentliche URL der API – daraus entsteht der Verifizierungslink */
  PUBLIC_BASE_URL: z.string().url(),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && !env.PUBLIC_BASE_URL.startsWith('https://')) {
    ctx.addIssue({ code: 'custom', path: ['PUBLIC_BASE_URL'], message: 'muss in Produktion https:// sein' });
  }
});

export type BotConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const r = schema.safeParse(env);
  if (!r.success) {
    throw new Error(`Ungültige Konfiguration:\n${r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  return r.data;
}
