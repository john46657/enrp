import {
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
  type SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
  type SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import { type ApiClient } from '@enrp/shared';
import { type ApiFactory } from './api';

export interface CommandContext {
  api: ApiClient;
  apis: ApiFactory;
}

export interface BotCommand {
  data:
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | SlashCommandOptionsOnlyBuilder
    | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
  /** Antwort sofort aufschieben (für API-Aufrufe), Standard: privat. */
  defer?: 'ephemeral' | 'public' | false;
  execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<unknown>;
  components?: Record<
    string,
    (
      interaction: MessageComponentInteraction | ModalSubmitInteraction,
      args: string[],
      ctx: CommandContext,
    ) => Promise<unknown>
  >;
}

export const defineCommand = (command: BotCommand) => command;
