import { Client, Events, GatewayIntentBits } from 'discord.js';
import pino from 'pino';
import { createPool } from '@emden-network/database';
import { OutboxProcessor, VerificationService, registerRoleSyncHandlers } from '@emden-network/core';
import { BRAND } from '@emden-network/shared';
import { loadConfig } from './config.js';
import { createServices } from './context.js';
import { commands } from './commands/index.js';
import { DiscordJsGateway } from './discord-gateway.js';
import { createInteractionHandler } from './interactions.js';

const cfg = loadConfig();
const log = pino({ level: cfg.LOG_LEVEL, redact: ['token', '*.token', 'DISCORD_TOKEN'], base: { service: 'emden-network-bot' } });
const pool = createPool({ connectionString: cfg.DATABASE_URL, applicationName: 'emden-network-bot' });

// Der Bot kennt kein Roblox-Client-Secret: er erzeugt nur Sessions, den OAuth-Austausch macht die API.
const verification = new VerificationService(pool, null, { publicBaseUrl: cfg.PUBLIC_BASE_URL });
const services = createServices(pool, verification, log);

// Nur der nicht-privilegierte Guilds-Intent: Mitglieder werden bei Bedarf per REST abgefragt.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const outbox = new OutboxProcessor(pool, {
  onError: (event, err, final) => log[final ? 'error' : 'warn']({ eventId: event.id, type: event.type, attempts: event.attempts, final, err: (err as Error)?.message }, 'Outbox-Event fehlgeschlagen'),
});
registerRoleSyncHandlers(outbox, pool, new DiscordJsGateway(client));

client.once(Events.ClientReady, (c) => {
  log.info({ user: c.user.tag, guilds: c.guilds.cache.size }, `${BRAND.name}-Bot bereit`);
  if (!c.guilds.cache.has(cfg.DISCORD_GUILD_ID)) log.warn({ guild: cfg.DISCORD_GUILD_ID }, 'Bot ist nicht auf dem konfigurierten Server');
  outbox.start(2000);
});

const onInteraction = createInteractionHandler(commands, services);
client.on(Events.InteractionCreate, (i) => {
  // Nur der konfigurierte Server wird bedient.
  if (i.guildId !== cfg.DISCORD_GUILD_ID) return;
  void onInteraction(i);
});
client.on(Events.Error, (err) => log.error({ err: err.message }, 'Discord-Client-Fehler'));
process.on('unhandledRejection', (err) => log.error({ err: (err as Error)?.message }, 'unhandledRejection'));

const shutdown = async (signal: string) => {
  log.info({ signal }, 'Fahre herunter');
  outbox.stop();
  await client.destroy();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await client.login(cfg.DISCORD_TOKEN);
