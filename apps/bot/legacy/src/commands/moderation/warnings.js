const { SlashCommandBuilder } = require('discord.js');
const { forGuild } = require('../../lib/settings');
const { replyPrivate, embed, truncate } = require('../../lib/util');
const { bucket, save } = require('../../lib/db');
const { guard, logAction } = require('../../lib/moderation');
const { isActive, syncWarnRoles } = require('../../lib/warnings');

// Zeile einer Verwarnung für die Übersicht (auch von /team genutzt).
function warningLine(w, i) {
  const state = w.expired || (w.expiresAt && w.expiresAt <= Date.now()) ? ' · *abgelaufen*' : w.expiresAt ? ` · läuft ab <t:${Math.floor(w.expiresAt / 1000)}:R>` : '';
  return `**#${i + 1}** – <t:${Math.floor(w.at / 1000)}:d> von <@${w.by}>${state}\n${w.reason}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verwarnungen')
    .setDescription('Verwarnungen anzeigen oder löschen.')
    .addSubcommand((s) =>
      s
        .setName('anzeigen')
        .setDescription('Zeigt alle Verwarnungen eines Nutzers.')
        .addUserOption((o) => o.setName('user').setDescription('Nutzer').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('loeschen')
        .setDescription('Löscht eine oder alle Verwarnungen eines Nutzers.')
        .addUserOption((o) => o.setName('user').setDescription('Nutzer').setRequired(true))
        .addIntegerOption((o) => o.setName('nummer').setDescription('Nummer der Verwarnung (leer = alle)').setMinValue(1)),
    ),
  warningLine,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const denied = guard(interaction, sub === 'anzeigen' ? 'viewLogs' : 'warn');
    if (denied) return replyPrivate(interaction, denied);
    const user = interaction.options.getUser('user');
    const warnings = bucket('warnings', interaction.guildId);
    const list = warnings[user.id] ?? [];

    if (sub === 'anzeigen') {
      if (!list.length) return replyPrivate(interaction, `${user} hat keine Verwarnungen. ✅`);
      const active = list.filter((w) => isActive(w)).length;
      return replyPrivate(interaction, {
        embeds: [
          embed('warning')
            .setTitle(`Verwarnungen von ${user.username} (${active} aktiv, ${list.length} gesamt)`)
            .setDescription(truncate(list.map(warningLine).join('\n\n'), 4000)),
        ],
      });
    }

    const number = interaction.options.getInteger('nummer');
    if (!list.length) return replyPrivate(interaction, `${user} hat keine Verwarnungen.`);
    if (number && number > list.length) return replyPrivate(interaction, `Es gibt nur ${list.length} Verwarnung(en).`);

    if (number) list.splice(number - 1, 1);
    else list.length = 0;
    if (!list.length) delete warnings[user.id];
    save();
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    await syncWarnRoles(member, forGuild(interaction.guildId).moderation.warnings, 'warnings');

    const what = number ? `Verwarnung #${number}` : 'Alle Verwarnungen';
    await replyPrivate(interaction, `🗑️ ${what} von ${user} gelöscht.`);
    await logAction(interaction.guild, { action: `${what} gelöscht`, target: user, moderator: interaction.user, reason: '—', color: 'success' });
  },
};
