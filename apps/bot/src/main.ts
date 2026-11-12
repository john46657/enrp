import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  InteractionContextType,
  MessageFlags,
  Partials,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
} from 'discord.js';
import { createLogger } from '@enrp/config';
import { legacyComponentPermission } from '@enrp/permissions';
import { createApiFactory, describeError } from './api';
import { type BotCommand } from './command';
import { COMMANDS } from './commands/index';
import { loadBotEnv } from './env';
import { loadLegacy, type LegacyBridge, type LegacyCommand } from './legacy';
import { legacyAccess } from './legacy-access';
import { startLegacyBridge } from './legacy-bridge';
import { COLORS } from './ui';

const env = loadBotEnv();
const logger = createLogger('bot', env.LOG_LEVEL);
const apis = createApiFactory(env);
const legacy: LegacyBridge | null = env.LEGACY_MODULES ? loadLegacy(logger) : null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // privilegiert: Begrüßung, Auto-Rolle, Rollenprüfung
    GatewayIntentBits.GuildMessages,
    ...(legacy ? [GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages] : []), // Ticket-Transkripte, Bewerbungen per DM
  ],
  partials: [Partials.GuildMember, Partials.Channel],
});

const commands = new Map<string, BotCommand>();
const components = new Map<string, NonNullable<BotCommand['components']>[string]>();
for (const command of COMMANDS) {
  (command.data as { setContexts: (...c: InteractionContextType[]) => unknown }).setContexts(
    InteractionContextType.Guild,
  );
  commands.set(command.data.name, command);
  for (const [prefix, handler] of Object.entries(command.components ?? {})) components.set(prefix, handler);
}
const legacyCommands = new Map((legacy?.commands ?? []).map((c) => [c.data.name, c]));
const legacyComponents = new Map(legacy?.commands.flatMap((c) => Object.entries(c.components ?? {})) ?? []);
for (const name of legacyCommands.keys()) if (commands.has(name)) throw new Error(`Doppelter Befehlsname /${name}`);

/** Laufend aktualisierte Bot-Konfiguration aus der API (Begrüßung, deaktivierte Befehle). */
let botConfig: {
  welcome: { enabled: boolean; channelId: string | null; title: string; message: string; color: string };
  bot: { presenceText: string; disabledCommands: string[] };
  flags: Record<string, boolean>;
} | null = null;

async function refreshConfig() {
  try {
    botConfig = await apis.service.get('/api/v1/bot/config');
  } catch (err) {
    logger.warn({ err: describeError(err) }, 'Bot-Konfiguration nicht abrufbar (API nicht erreichbar?)');
  }
}

function commandKey(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand(false);
  return sub ? `${interaction.commandName} ${sub}` : interaction.commandName;
}

async function handleCommand(interaction: ChatInputCommandInteraction) {
  const legacyCommand = legacyCommands.get(interaction.commandName);
  if (legacyCommand) return handleLegacyCommand(interaction, legacyCommand);
  const command = commands.get(interaction.commandName);
  if (!command) return;
  const key = commandKey(interaction);
  if (
    botConfig?.bot.disabledCommands.includes(interaction.commandName) ||
    botConfig?.bot.disabledCommands.includes(key)
  ) {
    return interaction.reply({ content: '⏸️ Dieser Befehl ist derzeit deaktiviert.', flags: MessageFlags.Ephemeral });
  }
  const defer = command.defer ?? 'ephemeral';
  if (defer) await interaction.deferReply(defer === 'ephemeral' ? { flags: MessageFlags.Ephemeral } : {});
  const api = apis.forInteraction(interaction);
  // Vorabprüfung inkl. Rollen-Overrides (/permissions grant|revoke). Die API prüft zusätzlich jede Aktion.
  const access = await api.post<{ allowed: boolean; permission: string | null; source: string }>(
    '/api/v1/permissions/check',
    { command: key },
  );
  if (!access.allowed) {
    const text = `⛔ Du darfst \`/${key}\` nicht verwenden${access.permission ? ` (benötigt \`${access.permission}\`)` : ''}.`;
    return defer ? interaction.editReply(text) : interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
  }
  return command.execute(interaction, { api, apis });
}

type AccessCheck = { allowed: boolean; source: string; permission: string | null };

/** Kurze Rechteprüfung bei der Plattform (höchstens 1,5 s). null = nicht erreichbar → bisheriges Verhalten. */
function quickCheck(interaction: Interaction, body: { command: string } | { permission: string }) {
  return Promise.race([
    apis
      .forInteraction(interaction)
      .post<AccessCheck>('/api/v1/permissions/check', body)
      .catch((err: unknown) => {
        logger.warn(
          { err: describeError(err), ...body },
          'Rechteprüfung für Altmodul nicht möglich – bisheriges Verhalten',
        );
        return null;
      }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500).unref()),
  ]);
}

/** Ergebnisse für Buttons kurz merken, damit Klickfolgen (Schließen → Bestätigen) nicht jedes Mal warten. */
const componentGrants = new Map<string, { allowed: boolean; at: number }>();
async function hasComponentGrant(interaction: Interaction, permission: string) {
  const key = `${interaction.guildId}:${interaction.user.id}:${permission}`;
  const hit = componentGrants.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.allowed;
  const access = await quickCheck(interaction, { permission });
  if (!access) return false;
  if (componentGrants.size > 2000) componentGrants.clear();
  componentGrants.set(key, { allowed: access.allowed, at: Date.now() });
  return access.allowed;
}

/** Altbefehle: kurze Rechteprüfung bei der Plattform (Altbefehle antworten selbst, ohne Aufschub). */
async function handleLegacyCommand(interaction: ChatInputCommandInteraction, legacyCommand: LegacyCommand) {
  const key = commandKey(interaction);
  const disabled = Boolean(
    botConfig?.bot.disabledCommands.includes(interaction.commandName) || botConfig?.bot.disabledCommands.includes(key),
  );
  const access = await quickCheck(interaction, { command: key });
  const required = legacyCommand.discordPermission ?? null;
  const decision = legacyAccess({
    disabled,
    access,
    hasDiscordPermission: required === null || Boolean(interaction.memberPermissions?.has(required)),
  });
  if (decision === 'disabled')
    return interaction.reply({ content: '⏸️ Dieser Befehl ist derzeit deaktiviert.', flags: MessageFlags.Ephemeral });
  if (decision === 'override-deny' || decision === 'denied')
    return interaction.reply({
      content: `⛔ Du darfst \`/${key}\` nicht verwenden${access?.permission ? ` (benötigt \`${access.permission}\`)` : ''}.`,
      flags: MessageFlags.Ephemeral,
    });
  if (decision === 'grant') return legacy!.runWithGrant(interaction.user.id, () => legacyCommand.execute(interaction));
  return legacyCommand.execute(interaction);
}

async function handleComponent(interaction: Interaction) {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return;
  const [prefix, ...args] = interaction.customId.split(':');
  const handler = components.get(prefix!);
  if (handler) return handler(interaction, args, { api: apis.forInteraction(interaction), apis });
  const legacyHandler = legacyComponents.get(prefix!);
  if (!legacyHandler) return;
  // Staff-Aktionen der Altmodule (Ticket übernehmen, Bewerbung entscheiden …): Plattform-Recht gilt als Staff.
  const permission = legacyComponentPermission(interaction.customId);
  if (permission && (await hasComponentGrant(interaction, permission)))
    return legacy!.runWithGrant(interaction.user.id, () => legacyHandler(interaction, args));
  return legacyHandler(interaction, args);
}

client.on(Events.InteractionCreate, async (interaction) => {
  const label = interaction.isChatInputCommand()
    ? `/${interaction.commandName}`
    : 'customId' in interaction
      ? interaction.customId
      : interaction.type;
  try {
    if (interaction.isAutocomplete()) {
      const command = legacyCommands.get(interaction.commandName);
      await interaction.respond(((await command?.autocomplete?.(interaction)) as never) ?? []);
      return;
    }
    if (interaction.isChatInputCommand()) await handleCommand(interaction);
    else await handleComponent(interaction);
  } catch (err) {
    const message = describeError(err);
    if (!(err as { status?: number }).status) logger.error({ err, label }, 'Interaktion fehlgeschlagen');
    if (!interaction.isRepliable()) return;
    const content = `❌ ${message}`;
    await (
      interaction.deferred || interaction.replied
        ? interaction.editReply({ content, embeds: [], components: [] })
        : interaction.reply({ content, flags: MessageFlags.Ephemeral })
    ).catch(() => {});
  }
});

/** Altmodule, Begrüßung und Auto-Rolle gelten nur im Haupt-Discord. */
const isMain = (guildId: string | null | undefined) => !env.guildId || guildId === env.guildId;

client.on(Events.MessageCreate, (message) => {
  if (!isMain(message.guildId) && message.guildId) return;
  if (legacy) legacy.onMessage(message).catch((err) => logger.error({ err }, 'messageCreate'));
});

client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
  if (!isMain(member.guild.id)) return;
  try {
    const welcome = botConfig?.welcome;
    if (welcome?.enabled && welcome.channelId) {
      const channel = await member.guild.channels.fetch(welcome.channelId).catch(() => null);
      const text = welcome.message
        .replaceAll('{user}', member.toString())
        .replaceAll('{name}', member.displayName)
        .replaceAll('{server}', member.guild.name)
        .replaceAll('{count}', String(member.guild.memberCount));
      if (channel?.isTextBased()) {
        await channel.send({
          content: member.toString(),
          embeds: [
            {
              title: welcome.title,
              description: text,
              color: parseInt(welcome.color.slice(1), 16) || COLORS.primary,
              thumbnail: { url: member.displayAvatarURL({ size: 256 }) },
            },
          ],
          allowedMentions: { users: [member.id] },
        });
      }
      await legacy?.autoRole(member);
    } else if (legacy) {
      await legacy.onMemberAdd(member);
    }
  } catch (err) {
    logger.error({ err }, 'guildMemberAdd');
  }
});

client.on(Events.GuildMemberRemove, (member) => {
  if (!isMain(member.guild.id)) return;
  if (legacy) legacy.onMemberRemove(member).catch((err) => logger.error({ err }, 'guildMemberRemove'));
});

const platformCommands = () => COMMANDS.map((c) => c.data.toJSON());

async function setupOtherGuild(guild: Guild) {
  try {
    await guild.commands.set(platformCommands() as never);
    await apis.service.post('/api/v1/bot/guilds', { id: guild.id, name: guild.name });
    logger.info({ guildId: guild.id }, 'Weiterer Discord eingerichtet');
  } catch (err) {
    logger.warn({ err, guildId: guild.id }, 'Weiteren Discord einrichten fehlgeschlagen');
  }
}

client.on(Events.GuildCreate, (guild) => {
  if (env.guildId && guild.id !== env.guildId) void setupOtherGuild(guild);
});
client.on(Events.GuildDelete, (guild) => {
  if (env.guildId && guild.id !== env.guildId)
    void apis.service
      .post(`/api/v1/bot/guilds/${guild.id}/left`, {})
      .catch((err) => logger.warn({ err, guildId: guild.id }, 'Abmelden des Discords fehlgeschlagen'));
});

client.once(Events.ClientReady, async (ready) => {
  logger.info({ tag: ready.user.tag }, 'Eingeloggt');
  const body = [...COMMANDS.map((c) => c.data.toJSON()), ...(legacy?.commands.map((c) => c.data.toJSON()) ?? [])];
  if (env.guildId) await ready.application.commands.set(body as never, env.guildId);
  else await ready.application.commands.set(body as never);
  logger.info({ count: body.length, scope: env.guildId ?? 'global' }, 'Slash-Commands registriert');
  // Weitere Discords (Privat-Server, andere): Plattform-Befehle ohne Altmodule, Server bei der Plattform melden.
  if (env.guildId) {
    for (const guild of ready.guilds.cache.values()) {
      if (guild.id !== env.guildId) await setupOtherGuild(guild);
    }
  }

  // Ticketpanel-Ereignisse in die Datenbank spiegeln (Dashboard).
  legacy?.setTicketHooks({
    open: (p) =>
      apis.service.post('/api/v1/tickets/sync', {
        event: 'open',
        channelId: p.channelId,
        creatorId: p.creatorId,
        subject: p.subject,
        category: p.category,
      }),
    claim: (p) =>
      apis.service.post('/api/v1/tickets/sync', { event: 'claim', channelId: p.channelId, assigneeId: p.assigneeId }),
    close: (p) =>
      apis.service.post('/api/v1/tickets/sync', {
        event: 'close',
        channelId: p.channelId,
        closedBy: p.closedBy,
        reason: p.reason,
      }),
  });
  await legacy?.onReady(ready);
  // Altmodule im Dashboard: Anfragen der Plattform abholen und mit den Altmodulen ausführen.
  if (legacy)
    startLegacyBridge({
      client: ready,
      api: apis.longPoll,
      handle: (guild, request) => legacy.handleRequest(guild, request),
      guildId: env.guildId,
      logger,
    });
  await refreshConfig();
  setInterval(refreshConfig, 60_000).unref();

  const instanceId = `${process.env.HOSTNAME ?? 'local'}-${randomUUID().slice(0, 8)}`;
  const beat = async () => {
    await apis.service
      .post('/api/v1/monitoring/heartbeat', {
        service: 'bot',
        instanceId,
        version: env.APP_VERSION,
        info: { guilds: ready.guilds.cache.size, ping: ready.ws.ping },
      })
      .catch((err) => logger.warn({ err: describeError(err) }, 'Heartbeat an API fehlgeschlagen'));
    // Präsenz mit echter Spielerzahl (oder Hinweis, wenn kein Server verbunden ist).
    const status = await apis.service
      .get<{ roblox: { connected: boolean; playersOnline: number } | null }>('/api/v1/status')
      .catch(() => null);
    const text = status?.roblox?.connected
      ? `${status.roblox.playersOnline} Spieler online`
      : (botConfig?.bot.presenceText ?? 'GermanRP');
    ready.user.setActivity(text, { type: ActivityType.Watching });
  };
  await beat();
  setInterval(beat, 30_000).unref();
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Bot fährt herunter …');
    try {
      legacy?.flush();
      await client.destroy();
    } finally {
      process.exit(0);
    }
  });
}
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));

client.login(env.token).catch((err: Error & { code?: string }) => {
  logger.fatal({ code: err.code, message: err.message }, 'Login fehlgeschlagen');
  if (/disallowed intents/i.test(err.message))
    logger.fatal(
      'Im Developer Portal unter „Bot“ die Privileged Intents „Server Members“ und „Message Content“ aktivieren.',
    );
  process.exit(1);
});
