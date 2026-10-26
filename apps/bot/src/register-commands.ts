import { REST, Routes } from 'discord.js';
import { z } from 'zod';
import { commands } from './commands/index.js';

/** Registriert alle Slash-Commands als Guild-Commands (sofort verfügbar). */
const env = z
  .object({ DISCORD_TOKEN: z.string().min(50), DISCORD_APPLICATION_ID: z.string().regex(/^\d{17,20}$/), DISCORD_GUILD_ID: z.string().regex(/^\d{17,20}$/) })
  .parse(process.env);

const rest = new REST().setToken(env.DISCORD_TOKEN);
const body = commands.map((c) => c.data.toJSON());
const result = (await rest.put(Routes.applicationGuildCommands(env.DISCORD_APPLICATION_ID, env.DISCORD_GUILD_ID), { body })) as unknown[];
console.log(`✅ ${result.length} Slash-Commands für Server ${env.DISCORD_GUILD_ID} registriert.`);
