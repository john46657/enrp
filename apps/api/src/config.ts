import { z } from 'zod';

const secret = (name: string) => z.string().min(32, `${name} muss mindestens 32 Zeichen lang sein`);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.string().url(),
    PUBLIC_BASE_URL: z.string().url(),
    TRUST_PROXY: z.string().optional(),
    COOKIE_SECURE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    ROBLOX_OAUTH_CLIENT_ID: z.string().regex(/^[0-9]+$/, 'ROBLOX_OAUTH_CLIENT_ID ist numerisch (Creator Dashboard)'),
    ROBLOX_OAUTH_CLIENT_SECRET: z.string().min(16),
    ROBLOX_OAUTH_BASE_URL: z.string().url().optional(),
    INTERNAL_API_TOKEN: secret('INTERNAL_API_TOKEN'),
    GAME_API_KEY: secret('GAME_API_KEY'),
    ALLOWED_PLACE_IDS: z
      .string()
      .default('')
      .transform((v) => new Set(v.split(',').map((s) => s.trim()).filter(Boolean).map(Number))),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    // Schutz vor unsicheren Einstellungen, die in Produktion versehentlich funktionieren würden.
    if (!env.PUBLIC_BASE_URL.startsWith('https://')) ctx.addIssue({ code: 'custom', path: ['PUBLIC_BASE_URL'], message: 'muss in Produktion https:// sein' });
    if (!env.COOKIE_SECURE) ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'muss in Produktion true sein' });
    if (env.ROBLOX_OAUTH_BASE_URL && env.ROBLOX_OAUTH_BASE_URL !== 'https://apis.roblox.com/oauth') {
      ctx.addIssue({ code: 'custom', path: ['ROBLOX_OAUTH_BASE_URL'], message: 'darf in Produktion nicht überschrieben werden' });
    }
    if (env.ALLOWED_PLACE_IDS.size === 0) ctx.addIssue({ code: 'custom', path: ['ALLOWED_PLACE_IDS'], message: 'muss in Produktion gesetzt sein' });
  });

export type ApiConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ungültige Konfiguration:\n${issues}`);
  }
  return result.data;
}

export function redirectUri(cfg: Pick<ApiConfig, 'PUBLIC_BASE_URL'>): string {
  return new URL('/auth/roblox/callback', cfg.PUBLIC_BASE_URL).toString();
}
