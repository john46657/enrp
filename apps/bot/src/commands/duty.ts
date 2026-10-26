import { AttachmentBuilder, SlashCommandBuilder } from 'discord.js';
import { AppError } from '@emden-network/shared';
import { ensureUser, getFaction, getMembership, startOwnDuty } from '@emden-network/core';
import type { Command } from '../context.js';
import { embed, formatDuration, parseGermanDateTime, ts } from '../format.js';
import { resolveFaction } from './faction.js';

const FACTIONS = [
  { name: 'Polizei', value: 'polizei' },
  { name: 'Feuerwehr', value: 'feuerwehr' },
  { name: 'Rettungsdienst', value: 'rettungsdienst' },
];
const PERIODS = [
  { name: '7 Tage', value: 7 },
  { name: '30 Tage', value: 30 },
  { name: '90 Tage', value: 90 },
];

export const duty: Command = {
  data: new SlashCommandBuilder()
    .setName('duty')
    .setDescription('Dienstsystem')
    .addSubcommand((s) =>
      s.setName('start').setDescription('Dienst beginnen').addStringOption((o) => o.setName('fraktion').setDescription('Fraktion').addChoices(...FACTIONS)),
    )
    .addSubcommand((s) => s.setName('stop').setDescription('Dienst beenden'))
    .addSubcommand((s) => s.setName('status').setDescription('Dienststatus').addUserOption((o) => o.setName('spieler').setDescription('Spieler (leer = du)')))
    .addSubcommand((s) =>
      s.setName('roster').setDescription('Wer ist im Dienst?').addStringOption((o) => o.setName('fraktion').setDescription('Fraktion').addChoices(...FACTIONS)),
    )
    .addSubcommand((s) =>
      s
        .setName('stats')
        .setDescription('Dienststatistik der Fraktion')
        .addIntegerOption((o) => o.setName('zeitraum').setDescription('Zeitraum').addChoices(...PERIODS))
        .addStringOption((o) => o.setName('fraktion').setDescription('Fraktion').addChoices(...FACTIONS)),
    )
    .addSubcommand((s) =>
      s
        .setName('correct')
        .setDescription('Dienstsitzung korrigieren')
        .addStringOption((o) => o.setName('sitzung').setDescription('Sitzungs-ID').setRequired(true).setMinLength(36).setMaxLength(36))
        .addStringOption((o) => o.setName('grund').setDescription('Grund').setRequired(true).setMinLength(3).setMaxLength(300))
        .addStringOption((o) => o.setName('beginn').setDescription('Neuer Beginn, z. B. 24.10.2026 18:30'))
        .addStringOption((o) => o.setName('ende').setDescription('Neues Ende, z. B. 24.10.2026 21:00')),
    )
    .addSubcommand((s) =>
      s
        .setName('export')
        .setDescription('Dienstzeiten als CSV exportieren')
        .addIntegerOption((o) => o.setName('zeitraum').setDescription('Zeitraum').setRequired(true).addChoices(...PERIODS))
        .addStringOption((o) => o.setName('fraktion').setDescription('Fraktion').addChoices(...FACTIONS)),
    ),

  async execute(ctx) {
    const sub = ctx.i.options.getSubcommand();
    const { pool, duty: dutyService } = ctx.services;
    switch (sub) {
      case 'start': {
        await ctx.require('duty.self');
        const userId = await ensureUser(pool, ctx.actor.discordId);
        const requested = ctx.i.options.getString('fraktion') as 'polizei' | 'feuerwehr' | 'rettungsdienst' | null;
        const { session } = await startOwnDuty(pool, dutyService, userId, ctx.actor.discordId, requested ?? undefined);
        await ctx.reply(`🟢 Dienst bei **${(await getFaction(pool, session.factionKey)).name}** begonnen (${ts(session.startedAt, 't')}).`);
        return;
      }
      case 'stop': {
        await ctx.require('duty.self');
        const userId = await ensureUser(pool, ctx.actor.discordId);
        const r = await dutyService.end({ userId });
        if (!r.session) {
          await ctx.reply('Du bist nicht im Dienst.');
          return;
        }
        const seconds = Math.round((r.session.endedAt!.getTime() - r.session.startedAt.getTime()) / 1000);
        await ctx.reply(`⚪ Dienst beendet. Dauer: **${formatDuration(seconds)}**${r.capped ? ' (auf 24 Stunden begrenzt)' : ''}.`);
        return;
      }
      case 'status': {
        const target = ctx.i.options.getUser('spieler') ?? ctx.i.user;
        if (target.id === ctx.actor.discordId) await ctx.require('self.read');
        else await ctx.require('duty.view_faction', (await getMembership(pool, target.id))?.factionKey);
        const s = await dutyService.current(target.id);
        await ctx.reply(
          s
            ? `🟢 <@${target.id}> ist seit ${ts(s.startedAt, 'R')} im Dienst (${s.source === 'game' ? 'im Spiel' : 'über Discord'}). Sitzung: \`${s.id}\``
            : `⚪ <@${target.id}> ist nicht im Dienst.`,
        );
        return;
      }
      case 'roster': {
        await ctx.require('faction.read');
        const key = await resolveFaction(ctx, ctx.i.options.getString('fraktion'));
        const list = await dutyService.onDuty(key);
        const lines = list.map((s) => `• <@${s.discordId}> seit ${ts(s.startedAt, 'R')}${s.source === 'game' ? ' 🎮' : ''}`);
        await ctx.reply({ embeds: [embed(`Im Dienst: ${(await getFaction(pool, key)).name}`, lines.join('\n') || 'Niemand im Dienst.')] });
        return;
      }
      case 'stats': {
        const key = await resolveFaction(ctx, ctx.i.options.getString('fraktion'));
        await ctx.require('duty.view_faction', key);
        const days = ctx.i.options.getInteger('zeitraum') ?? 7;
        const [total, top] = await Promise.all([dutyService.totalSeconds({ factionKey: key }, days), dutyService.topMembers(key, days)]);
        const lines = top.map((t, n) => `${n + 1}. <@${t.discordId}> – ${formatDuration(t.seconds)}`);
        await ctx.reply({
          embeds: [embed(`Dienststatistik ${(await getFaction(pool, key)).name} (${days} Tage)`, `Gesamt: **${formatDuration(total)}**\n\n${lines.join('\n') || 'Keine Dienstzeiten.'}`)],
        });
        return;
      }
      case 'correct': {
        const beginRaw = ctx.i.options.getString('beginn');
        const endRaw = ctx.i.options.getString('ende');
        if (!beginRaw && !endRaw) throw new AppError('VALIDATION', 400, 'beginn oder ende angeben');
        const startedAt = beginRaw ? parseGermanDateTime(beginRaw) : undefined;
        const endedAt = endRaw ? parseGermanDateTime(endRaw) : undefined;
        if (startedAt === null || endedAt === null) {
          await ctx.reply('Ungültiges Datum. Format: `TT.MM.JJJJ HH:MM` (deutsche Zeit).');
          return;
        }
        const s = await dutyService.correct(
          ctx.actor,
          ctx.guildId,
          ctx.i.options.getString('sitzung', true),
          { ...(startedAt ? { startedAt } : {}), ...(endedAt ? { endedAt } : {}) },
          ctx.i.options.getString('grund', true),
        );
        await ctx.reply(`✅ Sitzung korrigiert: ${ts(s.startedAt)} – ${s.endedAt ? ts(s.endedAt) : 'läuft'}.`);
        return;
      }
      case 'export': {
        const key = await resolveFaction(ctx, ctx.i.options.getString('fraktion'));
        const days = ctx.i.options.getInteger('zeitraum', true);
        await ctx.defer();
        const csv = await dutyService.exportCsv(ctx.actor, ctx.guildId, key, days);
        const file = new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: `dienstzeiten-${key}-${days}d.csv` });
        await ctx.edit({ content: `Export der letzten ${days} Tage (Zeitstempel in UTC).`, files: [file] });
        return;
      }
    }
  },
};
