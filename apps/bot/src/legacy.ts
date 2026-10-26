import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Client, type GuildMember, type Message, type PartialGuildMember } from 'discord.js';
import { type Logger } from '@enrp/config';

/**
 * Brücke zu den bestehenden JavaScript-Modulen in apps/bot/legacy (Bewerbungen, Ticketpanel, Level-System,
 * Rollenpanel, /einstellungen, /clear). Ersetzte Altbefehle (Moderation, FiveM-Status, Ankündigungen,
 * Umfragen, Hilfe) werden nicht mehr geladen – ihre Funktionen übernimmt die neue Plattform.
 */
const LEGACY_DIR = process.env.LEGACY_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'legacy');
const require = createRequire(path.join(LEGACY_DIR, 'index.js'));

export const LEGACY_COMMAND_FILES = [
  'applications/apply.js',
  'applications/bans.js',
  'applications/bewerbungspanel.js',
  'applications/list.js',
  'applications/qualipanel.js',
  'community/leaderboard.js',
  'community/rank.js',
  'community/rolepanel.js',
  'general/settings.js',
  'moderation/clear.js',
  'tickets/ticket.js',
];

export interface LegacyCommand {
  data: { name: string; toJSON(): unknown; setContexts(...c: unknown[]): unknown };
  execute(interaction: unknown): Promise<unknown>;
  components?: Record<string, (interaction: unknown, args: string[]) => Promise<unknown>>;
}

export interface LegacyBridge {
  commands: LegacyCommand[];
  onReady(client: Client): Promise<void>;
  onMessage(message: Message): Promise<void>;
  onMemberAdd(member: GuildMember): Promise<void>;
  /** Nur die Auto-Rolle aus der config.json vergeben (wenn die neue Begrüßung aktiv ist). */
  autoRole(member: GuildMember): Promise<void>;
  onMemberRemove(member: GuildMember | PartialGuildMember): Promise<void>;
  setTicketHooks(hooks: Record<string, (payload: Record<string, unknown>) => Promise<unknown>>): void;
  flush(): void;
}

export function loadLegacy(logger: Logger): LegacyBridge {
  require('./src/lib/settings'); // Einstellungen aus /einstellungen über config.json legen
  const { InteractionContextType } = require('discord.js');
  const commands = LEGACY_COMMAND_FILES.map((file) => {
    const command = require(`./src/commands/${file}`) as LegacyCommand;
    command.data.setContexts(InteractionContextType.Guild);
    return command;
  });
  const db = require('./src/lib/db');
  const tickets = require('./src/lib/tickets');
  const appStore = require('./src/lib/applications/store');
  const appMessages = require('./src/lib/applications/messages');
  const { sweep } = require('./src/lib/applications/flow');
  const { validateType } = require('./src/lib/applications/forms');
  const messageEvent = require('./src/events/messageCreate');
  const memberAdd = require('./src/events/guildMemberAdd');
  const memberRemove = require('./src/events/guildMemberRemove');

  return {
    commands,
    async onReady(client) {
      for (const guild of client.guilds.cache.values())
        await tickets.refreshPanels(guild).catch((err: Error) => logger.warn({ err: err.message }, 'Ticketpanel'));
      tickets.startTicketWatcher(client);
      appStore.resetProgress();
      for (const problem of appStore.types().flatMap(validateType)) logger.warn(`Bewerbung: ${problem}`);
      for (const guild of client.guilds.cache.values())
        await appMessages
          .refreshPanels(guild)
          .catch((err: Error) => logger.warn({ err: err.message }, 'Bewerbungspanel'));
      setInterval(
        () => sweep(client).catch((err: Error) => logger.error({ err: err.message }, 'Bewerbungen')),
        60_000,
      ).unref();
    },
    onMessage: (message) => messageEvent.execute(message),
    onMemberAdd: (member) => memberAdd.execute(member),
    async autoRole(member) {
      const config = require('./config.json');
      if (config.roles?.autoRole)
        await member.roles
          .add(config.roles.autoRole, 'Auto-Rolle')
          .catch((err: Error) => logger.warn({ err: err.message }, 'Auto-Rolle'));
    },
    onMemberRemove: (member) => memberRemove.execute(member),
    setTicketHooks(hooks) {
      Object.assign(tickets.hooks, hooks);
    },
    flush: () => db.flush(),
  };
}
