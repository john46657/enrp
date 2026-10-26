import {
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
  type SharedSlashCommand,
} from 'discord.js';
import { AppError, resolveRoleKeys, type Actor, type FactionKey, type Permission } from '@emden-network/shared';
import {
  DutyService,
  FactionService,
  GameService,
  authorize,
  getActiveLinkByDiscord,
  getGuildConfig,
  type GuildConfig,
  type VerificationService,
} from '@emden-network/core';
import type { Pool } from '@emden-network/database';
import type { Logger } from 'pino';

export interface Services {
  pool: Pool;
  verification: VerificationService;
  factions: FactionService;
  duty: DutyService;
  game: GameService;
  log: Logger;
  startedAt: Date;
}

export function createServices(pool: Pool, verification: VerificationService, log: Logger): Services {
  return { pool, verification, factions: new FactionService(pool), duty: new DutyService(pool), game: new GameService(pool), log, startedAt: new Date() };
}

type AnyInteraction = ChatInputCommandInteraction | ButtonInteraction | AutocompleteInteraction;

/**
 * Ermittelt die Rollen des Aufrufers aus den Rollen-IDs, die Discord mit der Interaktion liefert
 * (aktueller Stand zum Zeitpunkt der Interaktion), abgebildet über guild_config.role_map.
 */
export async function buildActor(i: AnyInteraction, services: Services): Promise<{ actor: Actor; config: GuildConfig }> {
  if (!i.inGuild()) throw new AppError('FORBIDDEN', 403, 'nur auf dem Server');
  const config = await getGuildConfig(services.pool, i.guildId);
  const member = i.member;
  const roleIds: string[] = Array.isArray(member.roles) ? member.roles : [...member.roles.cache.keys()];
  const roles = resolveRoleKeys(roleIds, config.roleMap);
  // Der Server-Eigentümer gilt immer als Owner (nötig für die Ersteinrichtung über /system config).
  if (i.guild?.ownerId === i.user.id) roles.add('owner');
  // „verifiziert“ ergibt sich verbindlich aus der Datenbank, nicht nur aus der Discord-Rolle.
  if (await getActiveLinkByDiscord(services.pool, i.user.id)) roles.add('verifiziert');
  else roles.delete('verifiziert');
  return { actor: { discordId: i.user.id, roles }, config };
}

export class CommandContext {
  constructor(
    readonly i: ChatInputCommandInteraction,
    readonly actor: Actor,
    readonly config: GuildConfig,
    readonly services: Services,
  ) {}

  get guildId(): string {
    return this.i.guildId!;
  }

  /** Serverseitige Berechtigungsprüfung mit Protokollierung verweigerter Versuche. */
  async require(permission: Permission, faction?: FactionKey): Promise<void> {
    await authorize(this.services.pool, this.actor, permission, { guildId: this.guildId, ...(faction ? { faction } : {}) });
  }

  async reply(options: string | InteractionReplyOptions, opts: { public?: boolean } = {}): Promise<void> {
    const base: InteractionReplyOptions = typeof options === 'string' ? { content: options } : options;
    const payload: InteractionReplyOptions = {
      allowedMentions: { parse: [] },
      ...base,
      ...(opts.public ? {} : { flags: MessageFlags.Ephemeral }),
    };
    if (this.i.deferred || this.i.replied) await this.i.followUp(payload);
    else await this.i.reply(payload);
  }

  async defer(): Promise<void> {
    if (!this.i.deferred && !this.i.replied) await this.i.deferReply({ flags: MessageFlags.Ephemeral });
  }

  async edit(options: string | Parameters<ChatInputCommandInteraction['editReply']>[0]): Promise<void> {
    await this.i.editReply(typeof options === 'string' ? { content: options, allowedMentions: { parse: [] } } : options);
  }
}

export interface Command {
  data: SharedSlashCommand;
  execute(ctx: CommandContext): Promise<void>;
  autocomplete?(i: AutocompleteInteraction, services: Services): Promise<void>;
  /** Button-Handler, zugeordnet über das Präfix der customId ("präfix:...") */
  buttons?: Record<string, (i: ButtonInteraction, services: Services) => Promise<void>>;
}
