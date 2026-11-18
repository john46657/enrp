import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { formatDuration } from '@enrp/shared';

export const COLORS = {
  primary: 0x2563eb,
  success: 0x16a34a,
  warning: 0xf59e0b,
  danger: 0xdc2626,
  muted: 0x64748b,
} as const;

export function embed(color: keyof typeof COLORS = 'primary') {
  return new EmbedBuilder().setColor(COLORS[color]).setTimestamp();
}

export const ts = (date: string | Date | null | undefined, style: 'f' | 'R' | 'd' = 'f') =>
  date ? `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>` : '–';
export const dur = (seconds: number | null | undefined) => formatDuration(seconds ?? 0);
export const user = (id: string | null | undefined) => (id && /^\d+$/.test(id) ? `<@${id}>` : (id ?? '–'));
export const trunc = (text: string, max = 1024) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

type Repliable = ChatInputCommandInteraction | MessageComponentInteraction | ModalSubmitInteraction;

/** Antwortet sichtbar nur für die Person (Standard für Verwaltungsbefehle). */
export async function reply(
  interaction: Repliable,
  content: string | EmbedBuilder | { embeds: EmbedBuilder[]; content?: string; files?: unknown[] },
  ephemeral = true,
) {
  const payload =
    typeof content === 'string'
      ? { content }
      : content instanceof EmbedBuilder
        ? { embeds: [content] }
        : (content as { embeds: EmbedBuilder[] });
  const flags = ephemeral ? MessageFlags.Ephemeral : undefined;
  const body = { ...payload, flags, allowedMentions: { parse: [] as never[] } } as never;
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload as never);
  return interaction.reply(body);
}

export function table(rows: Array<[string, string]>) {
  return rows.map(([k, v]) => `**${k}:** ${v}`).join('\n');
}
