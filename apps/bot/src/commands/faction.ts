import { SlashCommandBuilder, type AutocompleteInteraction, type SlashCommandSubcommandBuilder } from 'discord.js';
import { AppError, FACTION_KEYS, leadershipFactions, type FactionKey } from '@emden-network/shared';
import { getFaction, getMembership, getRoster, listRanks, type RankChangeMode } from '@emden-network/core';
import type { Command, CommandContext, Services } from '../context.js';
import { embed, sanitize, ts } from '../format.js';

const FACTION_CHOICES = [
  { name: 'Polizei', value: 'polizei' },
  { name: 'Feuerwehr', value: 'feuerwehr' },
  { name: 'Rettungsdienst', value: 'rettungsdienst' },
  { name: 'Zivilisten', value: 'zivil' },
];

const factionOption = (s: SlashCommandSubcommandBuilder, required = false) =>
  s.addStringOption((o) => o.setName('fraktion').setDescription('Fraktion').setRequired(required).addChoices(...FACTION_CHOICES));

const rankSub = (name: string, description: string) => (s: SlashCommandSubcommandBuilder) =>
  s
    .setName(name)
    .setDescription(description)
    .addUserOption((o) => o.setName('spieler').setDescription('Mitglied').setRequired(true))
    .addStringOption((o) => o.setName('rang').setDescription('Neuer Rang').setRequired(true).setAutocomplete(true));

/**
 * Bestimmt die Fraktion eines Commands: explizit gewählt, sonst die eigene Leitungsfraktion,
 * sonst die eigene Mitgliedschaft.
 */
export async function resolveFaction(ctx: CommandContext, explicit: string | null): Promise<FactionKey> {
  if (explicit) {
    if (!(FACTION_KEYS as readonly string[]).includes(explicit)) throw new AppError('VALIDATION', 400);
    return explicit as FactionKey;
  }
  const led = leadershipFactions(ctx.actor);
  if (led.length === 1) return led[0]!;
  const m = await getMembership(ctx.services.pool, ctx.actor.discordId);
  if (m) return m.factionKey;
  throw new AppError('VALIDATION', 400, 'Bitte eine Fraktion angeben');
}

async function rankChange(ctx: CommandContext, mode: RankChangeMode) {
  const target = ctx.i.options.getUser('spieler', true);
  const rank = ctx.i.options.getString('rang', true);
  if (target.id === ctx.actor.discordId) throw new AppError('FORBIDDEN', 403, 'eigener Rang');
  const r = await ctx.services.factions.changeRank(ctx.actor, ctx.guildId, target.id, rank, mode);
  const verb = mode === 'promote' ? 'befördert' : mode === 'demote' ? 'degradiert' : 'eingestuft';
  await ctx.reply(`✅ <@${target.id}> wurde von **${r.from.name}** zu **${r.to.name}** ${verb}. Denke daran, die Discord-Fraktionsrollen manuell anzupassen.`);
}

export const faction: Command = {
  data: new SlashCommandBuilder()
    .setName('faction')
    .setDescription('Fraktionsverwaltung')
    .addSubcommand((s) => factionOption(s.setName('info').setDescription('Informationen zu einer Fraktion'), true))
    .addSubcommand((s) => factionOption(s.setName('roster').setDescription('Mitgliederliste'), true))
    .addSubcommand((s) =>
      factionOption(s.setName('invite').setDescription('Verifiziertes Mitglied aufnehmen').addUserOption((o) => o.setName('spieler').setDescription('Spieler').setRequired(true))),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Mitglied entfernen')
        .addUserOption((o) => o.setName('spieler').setDescription('Mitglied').setRequired(true))
        .addStringOption((o) => o.setName('grund').setDescription('Grund').setRequired(true).setMinLength(3).setMaxLength(300)),
    )
    .addSubcommand(rankSub('promote', 'Mitglied befördern'))
    .addSubcommand(rankSub('demote', 'Mitglied degradieren'))
    .addSubcommand(rankSub('setrank', 'Rang direkt setzen'))
    .addSubcommand((s) =>
      factionOption(
        s.setName('announce').setDescription('Fraktionsankündigung in diesem Kanal').addStringOption((o) => o.setName('nachricht').setDescription('Text').setRequired(true).setMaxLength(1500)),
      ),
    )
    .addSubcommand((s) => s.setName('audit').setDescription('Fraktionsverlauf eines Mitglieds').addUserOption((o) => o.setName('spieler').setDescription('Mitglied').setRequired(true))),

  async execute(ctx) {
    const sub = ctx.i.options.getSubcommand();
    const pool = ctx.services.pool;
    switch (sub) {
      case 'info': {
        await ctx.require('faction.read');
        const key = await resolveFaction(ctx, ctx.i.options.getString('fraktion'));
        const f = await getFaction(pool, key);
        const [ranks, roster, onDuty] = await Promise.all([listRanks(pool, key), getRoster(pool, key), ctx.services.duty.onDuty(key)]);
        const e = embed(f.name).addFields(
          { name: 'Mitglieder', value: String(roster.length), inline: true },
          { name: 'Im Dienst', value: String(onDuty.length), inline: true },
          { name: 'Ränge', value: ranks.slice().reverse().map((r) => `• ${r.name}`).join('\n') || '–' },
        );
        await ctx.reply({ embeds: [e] });
        return;
      }
      case 'roster': {
        await ctx.require('faction.read');
        const key = await resolveFaction(ctx, ctx.i.options.getString('fraktion'));
        const roster = await getRoster(pool, key);
        const lines = roster.slice(0, 40).map((m) => `${m.onDuty ? '🟢' : '⚪'} **${m.rankName}** – <@${m.discordId}>${m.robloxUsername ? ` (${m.robloxUsername})` : ''}`);
        const more = roster.length > 40 ? `\n… und ${roster.length - 40} weitere` : '';
        await ctx.reply({ embeds: [embed(`Mitglieder: ${(await getFaction(pool, key)).name}`, (lines.join('\n') || 'Keine Mitglieder.') + more)] });
        return;
      }
      case 'invite': {
        const target = ctx.i.options.getUser('spieler', true);
        const key = await resolveFaction(ctx, ctx.i.options.getString('fraktion'));
        const r = await ctx.services.factions.invite(ctx.actor, ctx.guildId, key, target.id);
        await ctx.reply(`✅ <@${target.id}> ist jetzt Mitglied der Fraktion **${(await getFaction(pool, key)).name}** (Rang: ${r.rank.name}). Fraktionsrollen in Discord bitte manuell vergeben.`);
        return;
      }
      case 'remove': {
        const target = ctx.i.options.getUser('spieler', true);
        const reason = ctx.i.options.getString('grund', true);
        const r = await ctx.services.factions.remove(ctx.actor, ctx.guildId, target.id, reason);
        await ctx.reply(`✅ <@${target.id}> wurde aus **${(await getFaction(pool, r.factionKey)).name}** entfernt.`);
        return;
      }
      case 'promote':
      case 'demote':
        return rankChange(ctx, sub);
      case 'setrank':
        return rankChange(ctx, 'set');
      case 'announce': {
        const key = await resolveFaction(ctx, ctx.i.options.getString('fraktion'));
        await ctx.require('faction.announce', key);
        const f = await getFaction(pool, key);
        const text = sanitize(ctx.i.options.getString('nachricht', true));
        if (!ctx.i.channel?.isSendable()) throw new AppError('VALIDATION', 400, 'Kanal nicht beschreibbar');
        await ctx.i.channel.send({
          content: f.discordRoleId ? `<@&${f.discordRoleId}>` : undefined,
          embeds: [embed(`📢 ${f.name}`, text).setAuthor({ name: ctx.i.user.displayName })],
          allowedMentions: { roles: f.discordRoleId ? [f.discordRoleId] : [] },
        });
        await ctx.reply('✅ Ankündigung gesendet.');
        return;
      }
      case 'audit': {
        const target = ctx.i.options.getUser('spieler', true);
        const rows = await ctx.services.factions.memberAudit(ctx.actor, ctx.guildId, target.id);
        const lines = rows.map((r) => `${ts(r.occurred_at, 'd')} \`${r.action}\`${r.actor_id ? ` von <@${r.actor_id}>` : ''}${r.reason ? ` – ${sanitize(r.reason)}` : ''}`);
        await ctx.reply({ embeds: [embed(`Fraktionsverlauf: ${target.displayName}`, lines.join('\n') || 'Keine Einträge.')] });
        return;
      }
    }
  },

  /** Rang-Vorschläge passend zur Fraktion des gewählten Mitglieds */
  async autocomplete(i: AutocompleteInteraction, services: Services) {
    const userId = i.options.get('spieler')?.value;
    const focused = String(i.options.getFocused()).toLowerCase();
    let factionKey: string | undefined;
    if (typeof userId === 'string') factionKey = (await getMembership(services.pool, userId))?.factionKey;
    const ranks = factionKey ? await listRanks(services.pool, factionKey) : [];
    await i.respond(
      ranks
        .filter((r) => r.name.toLowerCase().includes(focused) || r.key.includes(focused))
        .slice(0, 25)
        .map((r) => ({ name: r.name, value: r.key })),
    );
  },
};
