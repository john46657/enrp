import { z } from 'zod';
import { baseEnvSchema, booleanFromString, optionalString, parseEnv } from '@enrp/config';

const schema = baseEnvSchema.extend({
  DISCORD_BOT_TOKEN: optionalString,
  /** Name aus der bisherigen .env des Legacy-Bots. */
  DISCORD_TOKEN: optionalString,
  DISCORD_GUILD_ID: optionalString,
  GUILD_ID: optionalString,
  API_URL: z.string().url().default('http://localhost:4000'),
  BOT_API_TOKEN: z.string().min(32),
  APP_VERSION: z.string().default('0.0.0-dev'),
  /** Bisherige Module (Bewerbungen, Ticketpanel, Level, Rollenpanel, /einstellungen) laden. */
  LEGACY_MODULES: booleanFromString.default(true),
});

export function loadBotEnv() {
  const env = parseEnv(schema);
  const token = env.DISCORD_BOT_TOKEN ?? env.DISCORD_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN fehlt.');
  return { ...env, token, guildId: env.DISCORD_GUILD_ID ?? env.GUILD_ID };
}
export type BotEnv = ReturnType<typeof loadBotEnv>;
