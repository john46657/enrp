const { SlashCommandBuilder } = require('discord.js');
const { forGuild } = require('../../lib/settings');
const { embed, replyPrivate, isStaff } = require('../../lib/util');
const counting = require('../../lib/counting');

const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('zaehlen')
    .setDescription('Zähl-Kanal: Stand, Bestenliste und Verwaltung.')
    .addSubcommand((s) => s.setName('stand').setDescription('Zeigt den aktuellen Stand und den Rekord.'))
    .addSubcommand((s) => s.setName('bestenliste').setDescription('Wer hat am meisten richtig gezählt?'))
    .addSubcommand((s) =>
      s
        .setName('setzen')
        .setDescription('Setzt den Stand (Staff), z. B. nach einem Fehler des Bots.')
        .addIntegerOption((o) => o.setName('zahl').setDescription('Zuletzt gezählte Zahl (0 = von vorn)').setMinValue(0).setMaxValue(1_000_000_000).setRequired(true)),
    ),

  async execute(interaction) {
    const cfg = forGuild(interaction.guildId).counting;
    if (!cfg.enabled || !cfg.channel) return replyPrivate(interaction, 'Das Zählen ist auf diesem Server nicht eingerichtet.');
    const s = counting.stateOf(interaction.guildId);

    switch (interaction.options.getSubcommand()) {
      case 'stand':
        return interaction.reply({
          embeds: [
            embed()
              .setTitle('🔢 Zählen')
              .addFields(
                { name: 'Aktuell', value: `**${s.current}**`, inline: true },
                { name: 'Nächste Zahl', value: `**${s.current + 1}**`, inline: true },
                { name: 'Rekord', value: `**${s.record}**${s.recordAt ? ` (<t:${Math.floor(s.recordAt / 1000)}:d>)` : ''}`, inline: true },
                { name: 'Kanal', value: `<#${cfg.channel}>`, inline: true },
                { name: 'Zuletzt gezählt', value: s.lastUserId ? `<@${s.lastUserId}>` : '—', inline: true },
              ),
          ],
          allowedMentions: { parse: [] },
        });
      case 'bestenliste': {
        const top = counting.topCounters(interaction.guildId);
        if (!top.length) return replyPrivate(interaction, 'Noch hat niemand gezählt.');
        const lines = top.map(([id, n], i) => `${MEDALS[i] ?? `**${i + 1}.**`} <@${id}> – ${n} Zahlen${s.fails[id] ? ` · ${s.fails[id]} Fehler` : ''}`);
        return interaction.reply({ embeds: [embed().setTitle('🏆 Beste Zähler').setDescription(lines.join('\n'))], allowedMentions: { parse: [] } });
      }
      case 'setzen': {
        if (!isStaff(interaction.member)) return replyPrivate(interaction, 'Nur Staff darf den Stand ändern.');
        const number = interaction.options.getInteger('zahl');
        counting.setCurrent(interaction.guildId, number);
        const channel = interaction.guild.channels.cache.get(cfg.channel);
        await channel?.send({ embeds: [embed('warning').setDescription(`🔧 ${interaction.user} hat den Stand auf **${number}** gesetzt. Weiter geht's mit **${number + 1}**.`)], allowedMentions: { parse: [] } }).catch(() => {});
        return replyPrivate(interaction, `Stand auf **${number}** gesetzt. Nächste Zahl: **${number + 1}**.`);
      }
    }
  },
};
